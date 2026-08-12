/**
 * Recognizes dependency specifiers that point at a package on the local file
 * system. Replaces the "npm-package-arg" dependency, which only ever was used
 * to answer this one question.
 *
 * Returns the path (possibly relative to the depending package) or null if the
 * specifier isn't a local one.
 */
export function getLocalDepPath(version) {
  if (typeof version !== 'string') {
    return null;
  }
  if (version.startsWith('file:')) {
    return version.slice('file:'.length);
  }
  // Bare paths: ./x, ../x, ~/x, /x, and Windows-style variants
  if (/^(\.{1,2}[/\\]|~[/\\]|[/\\]|[a-zA-Z]:[/\\])/.test(version)) {
    return version;
  }
  return null;
}

/** Returns the subset of `deps` that resolve to packages on the local file system. */
export function filterLocalDeps(deps) {
  let localDeps = {};
  for (let [dep, version] of Object.entries(deps)) {
    let localPath = getLocalDepPath(version);
    if (localPath !== null) {
      localDeps[dep] = localPath;
    }
  }
  return localDeps;
}
