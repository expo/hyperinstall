import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import Lock from './Lock.js';
import { readPackageChecksumAsync } from './checksum.js';
import { execNpmInstallAsync, execYarnInstallAsync } from './exec.js';
import { filterLocalDeps } from './localDeps.js';

const STATE_FILE = '.hyperinstall-state.json';
const CONFIG_FILE = 'hyperinstall.json';

// Global cache breaker to force updating all packages
const CACHE_BREAKER = 0;

export default class Hyperinstall {
  constructor(root) {
    this.root = root;
    this.forceClean = false;
    this.forceInstallation = false;
    this.state = {};
    this.updatedPackages = {};
    this.installLock = new Lock();
  }

  createPackageListAsync() {
    let filename = path.join(this.root, CONFIG_FILE);
    return fs.writeFile(filename, '{\n}\n');
  }

  async installAsync() {
    let [state, packages] = await Promise.all([
      this.readInstallationStateAsync(),
      this.readPackageListAsync(),
    ]);
    this.state = state;

    let packageEntries = Object.entries(packages);
    if (state.cacheBreaker !== CACHE_BREAKER) {
      console.log('Global cache breaker has been updated; installing all packages');
      await Promise.all(
        packageEntries.map(async ([name, cacheBreaker]) => {
          let targetPackageState = await this.readTargetPackageStateAsync(name);
          await this.updatePackageAsync(name, cacheBreaker, targetPackageState);
        })
      );
    } else {
      await Promise.all(
        packageEntries.map(async ([name, cacheBreaker]) => {
          await this.updatePackageIfNeededAsync(name, cacheBreaker);
        })
      );
    }

    let packageNames = Object.keys(this.updatedPackages);
    if (packageNames.length) {
      let count = packageNames.length;
      let packageWord = count === 1 ? 'package' : 'packages';
      console.log('Updated %d %s:', count, packageWord);
      for (let name of packageNames) {
        console.log('  %s', name);
      }
    }

    // Update the installation state
    state.cacheBreaker = CACHE_BREAKER;
    state.packages = { ...state.packages, ...this.updatedPackages };
    for (let name of Object.keys(state.packages)) {
      if (!Object.hasOwn(packages, name)) {
        delete state.packages[name];
      }
    }
    await this.writeInstallationStateAsync(state);
  }

  async readInstallationStateAsync() {
    let filename = path.join(this.root, STATE_FILE);
    let contents;
    try {
      contents = await fs.readFile(filename, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        return {};
      }
      throw e;
    }
    return JSON.parse(contents);
  }

  async writeInstallationStateAsync(state) {
    let contents = JSON.stringify(state, null, 2);
    let filename = path.join(this.root, STATE_FILE);
    await fs.writeFile(filename, contents, 'utf8');
  }

  async readPackageListAsync() {
    let filename = path.join(this.root, CONFIG_FILE);
    let contents;
    try {
      contents = await fs.readFile(filename, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.warn(`Specify the packages to install in ${CONFIG_FILE}.`);
        return {};
      }
      throw e;
    }
    return JSON.parse(contents);
  }

  async readTargetPackageStateAsync(name) {
    let [deps, yarnLockfile, shrinkwrap] = await Promise.all([
      this.readPackageDepsAsync(name),
      this.readYarnLockfileAsync(name),
      this.readShrinkwrapAsync(name),
    ]);

    if (yarnLockfile) {
      return { yarnLockfile };
    }

    let unversionedDepChecksums = await this.readUnversionedDepChecksumsAsync(name, deps);
    return {
      dependencies: deps,
      unversionedDependencyChecksums: unversionedDepChecksums,
      shrinkwrap,
    };
  }

  async updatePackageIfNeededAsync(name, cacheBreaker) {
    let targetPackageState = await this.readTargetPackageStateAsync(name);
    if (this.forceClean) {
      await this.removeNodeModulesDirAsync(name);
    }
    if (this.forceInstallation) {
      await this.updatePackageAsync(name, cacheBreaker, targetPackageState);
    } else {
      let needsUpdate = await this.packageNeedsUpdateAsync(name, cacheBreaker, targetPackageState);
      if (needsUpdate) {
        await this.updatePackageAsync(name, cacheBreaker, targetPackageState);
      }
    }
  }

  async updatePackageAsync(name, cacheBreaker, targetPackageState) {
    let packagePath = path.resolve(this.root, name);
    await this.installLock.acquireAsync();
    try {
      console.log('Package "%s" has been updated; installing...', name);
      await this.execInstallAsync(packagePath, Boolean(targetPackageState.yarnLockfile));
      console.log('Finished installing "%s"\n', name);
    } finally {
      this.installLock.release();
    }

    this.updatedPackages[name] = {
      ...targetPackageState,
      cacheBreaker,
    };
  }

  /** Overridable seam: runs the package manager in `packagePath`. */
  async execInstallAsync(packagePath, useYarn) {
    if (useYarn) {
      await execYarnInstallAsync(packagePath);
    } else {
      await execNpmInstallAsync(packagePath);
    }
  }

  async removeNodeModulesDirAsync(name) {
    let nodeModulesPath = path.resolve(this.root, name, 'node_modules');
    await fs.rm(nodeModulesPath, { recursive: true, force: true });
    console.log('Removed node_modules for "%s"\n', name);
  }

  async readYarnLockfileAsync(name) {
    let lockfilePath = path.resolve(this.root, name, 'yarn.lock');
    let lockfile;
    try {
      lockfile = await fs.readFile(lockfilePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        return undefined;
      }
      throw e;
    }
    return lockfile;
  }

  async readShrinkwrapAsync(name) {
    let shrinkwrapJSONPath = path.resolve(this.root, name, 'npm-shrinkwrap.json');
    let shrinkwrapJSON;
    try {
      shrinkwrapJSON = await fs.readFile(shrinkwrapJSONPath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        return undefined;
      }
      throw e;
    }
    return JSON.parse(shrinkwrapJSON);
  }

  async readPackageDepsAsync(name) {
    let packageJSONPath = path.resolve(this.root, name, 'package.json');
    let packageJSON = JSON.parse(await fs.readFile(packageJSONPath, 'utf8'));
    return { ...packageJSON.dependencies, ...packageJSON.devDependencies };
  }

  async readUnversionedDepChecksumsAsync(name, deps) {
    let packagePath = path.resolve(this.root, name);
    let localDeps = filterLocalDeps(deps);
    let checksums = await Promise.all(
      Object.entries(localDeps).map(async ([dep, depPath]) => {
        let absoluteDepPath = path.resolve(packagePath, depPath);
        return [dep, await readPackageChecksumAsync(absoluteDepPath)];
      })
    );
    return Object.fromEntries(checksums);
  }

  async packageNeedsUpdateAsync(name, cacheBreaker, targetPackageState) {
    let packageState = this.state.packages?.[name];
    if (!packageState || packageState.cacheBreaker !== cacheBreaker) {
      return true;
    }

    let targetYarnLockfile = targetPackageState.yarnLockfile;
    if (targetYarnLockfile) {
      let installedYarnLockfile = packageState.yarnLockfile;
      if (targetYarnLockfile !== installedYarnLockfile) {
        return true;
      }
    } else {
      let targetShrinkwrap = targetPackageState.shrinkwrap;
      let installedShrinkwrap = packageState.shrinkwrap;
      if (targetShrinkwrap && !isDeepStrictEqual(targetShrinkwrap, installedShrinkwrap)) {
        return true;
      }

      let targetDeps = targetPackageState.dependencies;
      let installedDeps = packageState.dependencies;
      if (!isDeepStrictEqual(targetDeps, installedDeps)) {
        return true;
      }

      let targetUnversionedDepChecksums = targetPackageState.unversionedDependencyChecksums;
      let installedUnversionedDepChecksums = packageState.unversionedDependencyChecksums;
      if (!isDeepStrictEqual(targetUnversionedDepChecksums, installedUnversionedDepChecksums)) {
        return true;
      }
    }

    // If node_modules is missing, we definitely need to update the package
    let nodeModulesPath = path.resolve(this.root, name, 'node_modules');
    let isNodeModulesPresent = await this.isDirectoryAsync(nodeModulesPath);
    return !isNodeModulesPresent;
  }

  async cleanAsync() {
    let stateFilename = path.join(this.root, STATE_FILE);
    await fs.rm(stateFilename, { force: true });
  }

  async isDirectoryAsync(directoryPath) {
    let stat;
    try {
      stat = await fs.stat(directoryPath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return false;
      }
      throw e;
    }
    return stat.isDirectory();
  }
}
