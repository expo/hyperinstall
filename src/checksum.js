import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const IGNORED_ENTRIES = new Set(['node_modules', '.git', '.hg', '.svn', '.DS_Store']);
const GIT_TIMEOUT = 30000;
const FILE_CONCURRENCY = 8;

/**
 * Lists the files Git considers part of the package: everything tracked, plus
 * untracked files that aren't ignored. This keeps build output, caches, and
 * logs from making a package look like it changed. Returns null if the package
 * isn't in a Git work tree, if Git isn't installed, or if the package itself is
 * ignored, in which case the caller falls back to walking the directory.
 */
async function readGitFileListAsync(packagePath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: packagePath, timeout: GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024 }
    ));
  } catch {
    return null;
  }
  let files = stdout.split('\0').filter(Boolean);
  return files.length ? files : null;
}

/**
 * Lists the files matched by the "files" field of package.json. npm publishes
 * these even when Git ignores them, which is how packages ship build output
 * that isn't checked in.
 */
async function readPublishedFileListAsync(packagePath) {
  let packageJSON;
  try {
    packageJSON = JSON.parse(await fs.readFile(path.join(packagePath, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(packageJSON.files)) {
    return [];
  }

  let files = [];
  for (let pattern of packageJSON.files) {
    // Negated patterns only ever remove files from the list, so ignoring them
    // can add files but never miss a change
    if (typeof pattern !== 'string' || pattern.startsWith('!')) {
      continue;
    }
    let matches;
    try {
      matches = await Array.fromAsync(fs.glob(pattern, { cwd: packagePath }));
    } catch {
      continue;
    }
    for (let match of matches) {
      // npm never publishes node_modules or VCS metadata, even when a broad
      // pattern like "**/*.js" matches files inside them
      if (match.split(/[/\\]/).some(segment => IGNORED_ENTRIES.has(segment))) {
        continue;
      }
      let matchPath = path.join(packagePath, match);
      let stats = await fs.lstat(matchPath).catch(() => null);
      if (stats?.isDirectory()) {
        for await (let file of walkFilesAsync(matchPath)) {
          files.push(toPosixPath(path.join(match, file)));
        }
      } else if (stats?.isFile()) {
        files.push(toPosixPath(match));
      }
    }
  }
  return files;
}

/**
 * Yields the files under `dir` relative to it, skipping installed dependencies,
 * VCS metadata, and symbolic links.
 */
async function* walkFilesAsync(dir, relativeTo = dir) {
  let entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let entry of entries) {
    if (IGNORED_ENTRIES.has(entry.name)) {
      continue;
    }
    let entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFilesAsync(entryPath, relativeTo);
    } else if (entry.isFile()) {
      yield toPosixPath(path.relative(relativeTo, entryPath));
    }
  }
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

/**
 * Splits a package's files into the ones worth reading and the ones worth only
 * stat'ing:
 *
 * - `contentFiles` are the files Git knows about, which are the ones a person
 *   edits. They are hashed by content so that switching branches back and forth
 *   doesn't look like a change.
 * - `metadataFiles` are files that the "files" field of package.json publishes
 *   but Git ignores, which is how packages ship build output that isn't checked
 *   in. Reading all of them can mean gigabytes of build artifacts, so they are
 *   hashed by size and modification time instead.
 *
 * Outside of a Git work tree there is nothing to tell source apart from build
 * output, so every file is read.
 */
async function readFileListsAsync(packagePath) {
  let gitFiles = await readGitFileListAsync(packagePath);
  if (!gitFiles) {
    return { contentFiles: (await Array.fromAsync(walkFilesAsync(packagePath))).sort() };
  }
  let tracked = new Set(gitFiles);
  let publishedFiles = await readPublishedFileListAsync(packagePath);
  return {
    contentFiles: [...tracked].sort(),
    metadataFiles: [...new Set(publishedFiles.filter(file => !tracked.has(file)))].sort(),
  };
}

export async function readFileChecksumAsync(filePath, algorithm = 'sha1') {
  let contents = await fs.readFile(filePath);
  return crypto.createHash(algorithm).update(contents).digest('hex');
}

/** Maps over the files, `FILE_CONCURRENCY` at a time, keeping the input order. */
async function mapFilesAsync(packagePath, files, digestAsync) {
  let digests = new Array(files.length);
  let nextIndex = 0;
  let digestNextAsync = async () => {
    while (nextIndex < files.length) {
      let index = nextIndex++;
      digests[index] = await digestAsync(path.join(packagePath, ...files[index].split('/')));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, digestNextAsync)
  );
  return digests;
}

/** Checksums a file, or returns undefined if it isn't a readable regular file. */
async function readOptionalFileChecksumAsync(filePath, algorithm) {
  try {
    return await readFileChecksumAsync(filePath, algorithm);
  } catch (e) {
    // Git lists deleted-but-tracked files and submodules; dropping them from
    // the checksum is itself a change since file names are hashed
    if (e.code === 'ENOENT' || e.code === 'EISDIR') {
      return undefined;
    }
    throw e;
  }
}

/** Describes a file by its size and modification time instead of its contents. */
async function readFileMetadataAsync(filePath) {
  let stats = await fs.stat(filePath).catch(() => null);
  return stats?.isFile() ? `${stats.size}:${stats.mtimeMs}` : undefined;
}

/**
 * Computes a stable checksum of a package directory (or of a single file, like
 * a tarball). Replaces the deprecated "fstream-npm" dependency, which computed
 * the exact set of files `npm publish` would include.
 */
export async function readPackageChecksumAsync(packagePath, algorithm = 'sha1') {
  let stats = await fs.stat(packagePath);
  if (!stats.isDirectory()) {
    return readFileChecksumAsync(packagePath, algorithm);
  }

  let { contentFiles, metadataFiles = [] } = await readFileListsAsync(packagePath);
  let [checksums, metadata] = await Promise.all([
    mapFilesAsync(packagePath, contentFiles, filePath =>
      readOptionalFileChecksumAsync(filePath, algorithm)
    ),
    mapFilesAsync(packagePath, metadataFiles, readFileMetadataAsync),
  ]);

  // Hash the file names along with the file checksums so that renaming or
  // removing a file changes the result
  let hash = crypto.createHash(algorithm);
  for (let [files, digests] of [
    [contentFiles, checksums],
    [metadataFiles, metadata],
  ]) {
    for (let [index, file] of files.entries()) {
      if (digests[index] !== undefined) {
        hash.update(`${file}\0${digests[index]}\0`, 'utf8');
      }
    }
  }
  return hash.digest('hex');
}
