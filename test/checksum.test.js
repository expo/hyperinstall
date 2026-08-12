import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { readPackageChecksumAsync } from '../src/checksum.js';

const execFileAsync = promisify(execFile);

let tempDirs = [];

async function writeFilesAsync(dir, files) {
  for (let [name, contents] of Object.entries(files)) {
    let filePath = path.join(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
  }
}

async function makePackageAsync(files) {
  let dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-checksum-'));
  tempDirs.push(dir);
  await writeFilesAsync(dir, files);
  return dir;
}

/** Creates a Git repository with the package at `packageDir` inside it. */
async function makeGitPackageAsync(files, { packageDir = '.', repoFiles = {} } = {}) {
  let repo = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-git-'));
  tempDirs.push(repo);
  await execFileAsync('git', ['init', '--quiet'], { cwd: repo });
  await writeFilesAsync(repo, repoFiles);
  let dir = path.join(repo, packageDir);
  await fs.mkdir(dir, { recursive: true });
  await writeFilesAsync(dir, files);
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('readPackageChecksumAsync', () => {
  it('is stable for identical directories', async () => {
    let files = { 'package.json': '{"name":"a"}', 'src/index.js': 'export default 1;\n' };
    let [a, b] = await Promise.all([makePackageAsync(files), makePackageAsync(files)]);
    assert.equal(await readPackageChecksumAsync(a), await readPackageChecksumAsync(b));
  });

  it('changes when file contents change', async () => {
    let dir = await makePackageAsync({ 'index.js': 'a' });
    let before = await readPackageChecksumAsync(dir);
    await fs.writeFile(path.join(dir, 'index.js'), 'b');
    assert.notEqual(await readPackageChecksumAsync(dir), before);
  });

  it('changes when a file is renamed', async () => {
    let dir = await makePackageAsync({ 'index.js': 'a' });
    let before = await readPackageChecksumAsync(dir);
    await fs.rename(path.join(dir, 'index.js'), path.join(dir, 'main.js'));
    assert.notEqual(await readPackageChecksumAsync(dir), before);
  });

  it('changes when a file is added or removed', async () => {
    let dir = await makePackageAsync({ 'index.js': 'a' });
    let before = await readPackageChecksumAsync(dir);
    await fs.writeFile(path.join(dir, 'extra.js'), '');
    let withExtra = await readPackageChecksumAsync(dir);
    assert.notEqual(withExtra, before);
    await fs.rm(path.join(dir, 'extra.js'));
    assert.equal(await readPackageChecksumAsync(dir), before);
  });

  it('ignores node_modules and VCS directories', async () => {
    let dir = await makePackageAsync({ 'index.js': 'a' });
    let before = await readPackageChecksumAsync(dir);
    await fs.mkdir(path.join(dir, 'node_modules/left-pad'), { recursive: true });
    await fs.writeFile(path.join(dir, 'node_modules/left-pad/index.js'), 'noise');
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, '.git/HEAD'), 'noise');
    assert.equal(await readPackageChecksumAsync(dir), before);
  });

  it('checksums a single file, such as a tarball', async () => {
    let dir = await makePackageAsync({ 'pkg.tgz': 'tarball' });
    let checksum = await readPackageChecksumAsync(path.join(dir, 'pkg.tgz'));
    assert.match(checksum, /^[0-9a-f]{40}$/);
  });
});

describe('readPackageChecksumAsync in a Git work tree', () => {
  it('ignores files that Git ignores, like build output and logs', async () => {
    let dir = await makeGitPackageAsync({
      '.gitignore': 'dist\n*.log\n',
      'package.json': '{"name":"a"}',
      'src/index.js': 'a',
      'dist/bundle.js': 'built',
      'npm-debug.log': 'noise',
    });
    let before = await readPackageChecksumAsync(dir);

    await fs.writeFile(path.join(dir, 'dist/bundle.js'), 'rebuilt');
    await fs.writeFile(path.join(dir, 'npm-debug.log'), 'more noise');

    assert.equal(await readPackageChecksumAsync(dir), before);
  });

  it('detects changes to files that Git does not ignore', async () => {
    let dir = await makeGitPackageAsync({
      '.gitignore': 'dist\n',
      'package.json': '{"name":"a"}',
      'src/index.js': 'a',
    });
    let before = await readPackageChecksumAsync(dir);

    await fs.writeFile(path.join(dir, 'src/index.js'), 'b');
    let changed = await readPackageChecksumAsync(dir);
    assert.notEqual(changed, before);

    await fs.writeFile(path.join(dir, 'src/added.js'), 'new file');
    assert.notEqual(await readPackageChecksumAsync(dir), changed);
  });

  it('includes ignored files that the "files" field publishes', async () => {
    let dir = await makeGitPackageAsync({
      '.gitignore': 'dist\n',
      'package.json': '{"name":"a","files":["dist","README.md"]}',
      'README.md': 'readme',
      'src/index.js': 'a',
      'dist/bundle.js': 'built',
      'dist/nested/chunk.js': 'chunk',
    });
    let before = await readPackageChecksumAsync(dir);

    await fs.writeFile(path.join(dir, 'dist/nested/chunk.js'), 'rebuilt chunk');

    assert.notEqual(await readPackageChecksumAsync(dir), before);
  });

  it('never publishes node_modules, even for broad "files" patterns', async () => {
    let dir = await makeGitPackageAsync({
      '.gitignore': 'dist\nnode_modules\n',
      'package.json': '{"name":"a","files":["**/*.js"]}',
      'dist/bundle.js': 'built',
    });
    await fs.mkdir(path.join(dir, 'node_modules/dep'), { recursive: true });
    await fs.writeFile(path.join(dir, 'node_modules/dep/index.js'), 'noise');
    let before = await readPackageChecksumAsync(dir);

    await fs.writeFile(path.join(dir, 'node_modules/dep/index.js'), 'installed noise');

    assert.equal(await readPackageChecksumAsync(dir), before);
  });

  it('detects a touched published file even when its size is unchanged', async () => {
    let dir = await makeGitPackageAsync({
      '.gitignore': 'dist\n',
      'package.json': '{"name":"a","files":["dist"]}',
      'dist/bundle.js': 'built',
    });
    let before = await readPackageChecksumAsync(dir);

    let bundlePath = path.join(dir, 'dist/bundle.js');
    await fs.writeFile(bundlePath, 'BUILT');
    await fs.utimes(bundlePath, new Date(0), new Date(0));

    assert.notEqual(await readPackageChecksumAsync(dir), before);
  });

  it('falls back to walking when Git is not installed', async () => {
    let dir = await makeGitPackageAsync({
      '.gitignore': 'dist\n',
      'package.json': '{"name":"a"}',
      'src/index.js': 'a',
      'dist/bundle.js': 'built',
    });
    let emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-nogit-'));
    tempDirs.push(emptyDir);

    let originalPath = process.env.PATH;
    process.env.PATH = emptyDir;
    try {
      let before = await readPackageChecksumAsync(dir);
      await fs.writeFile(path.join(dir, 'src/index.js'), 'b');
      let afterSource = await readPackageChecksumAsync(dir);
      assert.notEqual(afterSource, before);

      // Without Git there is no way to tell build output from source, so
      // ignored files count toward the checksum rather than being missed
      await fs.writeFile(path.join(dir, 'dist/bundle.js'), 'rebuilt');
      assert.notEqual(await readPackageChecksumAsync(dir), afterSource);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('falls back to walking when the package itself is ignored', async () => {
    let dir = await makeGitPackageAsync(
      { 'package.json': '{"name":"a"}', 'index.js': 'a' },
      { packageDir: 'vendor/pkg', repoFiles: { '.gitignore': 'vendor\n' } }
    );
    let before = await readPackageChecksumAsync(dir);

    await fs.writeFile(path.join(dir, 'index.js'), 'b');

    assert.notEqual(await readPackageChecksumAsync(dir), before);
  });
});
