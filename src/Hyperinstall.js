import 'instapromise';

import AwaitLock from 'await-lock';

import crypto from 'crypto';
import fs from 'fs';
import fstreamNpm from 'fstream-npm';
import get from 'lodash/get';
import isEmpty from 'lodash/isEmpty';
import isEqual from 'lodash/isEqual';
import map from 'lodash/map';
import sortBy from 'lodash/sortBy';
import toPairsIn from 'lodash/toPairsIn';
import npmPackageArg from 'npm-package-arg';
import path from 'path';
import rimraf from 'rimraf';
import promiseProps from '@exponent/promise-props';

import { execNpmInstallAsync } from './npm';
import { execYarnInstallAsync } from './yarn';

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
    this.installLock = new AwaitLock();
  }

  createPackageListAsync() {
    let filename = path.join(this.root, CONFIG_FILE);
    return fs.promise.writeFile(filename, '{\n}\n');
  }

  async installAsync() {
    let [state, packages] = await Promise.all([
      this.readInstallationStateAsync(),
      this.readPackageListAsync(),
    ]);
    this.state = state;

    if (state.cacheBreaker !== CACHE_BREAKER) {
      console.log(
        'Global cache breaker has been updated; installing all packages'
      );
      await Promise.all(
        map(packages, async (cacheBreaker, name) => {
          let targetPackageState = await this.readTargetPackageStateAsync(name);
          await this.updatePackageAsync(name, cacheBreaker, targetPackageState);
        })
      );
    } else {
      await Promise.all(
        map(packages, async (cacheBreaker, name) => {
          await this.updatePackageIfNeededAsync(name, cacheBreaker);
        })
      );
    }

    if (!isEmpty(this.updatedPackages)) {
      let packageNames = Object.keys(this.updatedPackages);
      let count = packageNames.length;
      let packageWord = count === 1 ? 'package' : 'packages';
      console.log('Updated %d %s:', count, packageWord);
      for (let name of packageNames) {
        console.log('  %s', name);
      }
    }

    // Update the installation state
    state.cacheBreaker = CACHE_BREAKER;
    state.packages = Object.assign({}, state.packages, this.updatedPackages);
    for (let name of Object.keys(state.packages)) {
      if (!packages.hasOwnProperty(name)) {
        delete state.packages[name];
      }
    }
    await this.writeInstallationStateAsync(state);
  }

  async readInstallationStateAsync() {
    let filename = path.join(this.root, STATE_FILE);
    let contents;
    try {
      contents = await fs.promise.readFile(filename, 'utf8');
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
    await fs.promise.writeFile(filename, contents, 'utf8');
  }

  async readPackageListAsync() {
    let filename = path.join(this.root, CONFIG_FILE);
    let contents;
    try {
      contents = await fs.promise.readFile(filename, 'utf8');
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

    let unversionedDepChecksums = await this.readUnversionedDepChecksumsAsync(
      name,
      deps
    );
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
      let needsUpdate = await this.packageNeedsUpdateAsync(
        name,
        cacheBreaker,
        targetPackageState
      );
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
      if (targetPackageState.yarnLockfile) {
        await execYarnInstallAsync(packagePath);
      } else {
        await execNpmInstallAsync(packagePath);
      }
      console.log('Finished installing "%s"\n', name);
    } finally {
      this.installLock.release();
    }

    this.updatedPackages[name] = {
      ...targetPackageState,
      cacheBreaker,
    };
  }

  async removeNodeModulesDirAsync(name) {
    let nodeModulesPath = path.resolve(this.root, name, 'node_modules');
    await rimraf.promise(nodeModulesPath);
    console.log('Removed node_modules for "%s"\n', name);
  }

  async readYarnLockfileAsync(name) {
    let lockfilePath = path.resolve(this.root, name, 'yarn.lock');
    let lockfile;
    try {
      lockfile = await fs.promise.readFile(lockfilePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        return undefined;
      }
      throw e;
    }
    return lockfile;
  }

  async readShrinkwrapAsync(name) {
    let shrinkwrapJSONPath = path.resolve(
      this.root,
      name,
      'npm-shrinkwrap.json'
    );
    let shrinkwrapJSON;
    try {
      shrinkwrapJSON = await fs.promise.readFile(shrinkwrapJSONPath, 'utf8');
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
    let packageJSON = await fs.promise.readFile(packageJSONPath, 'utf8');
    packageJSON = JSON.parse(packageJSON);

    let packageDeps = {};
    Object.assign(packageDeps, packageJSON.dependencies);
    Object.assign(packageDeps, packageJSON.devDependencies);
    return packageDeps;
  }

  async readUnversionedDepChecksumsAsync(name, deps) {
    let packagePath = path.resolve(this.root, name);
    let unversionedDeps = this.filterLocalDeps(name, deps);
    let promises = {};
    for (let [dep, depPath] of toPairsIn(unversionedDeps)) {
      let absoluteDepPath = path.resolve(packagePath, depPath);
      promises[dep] = this.readPackageChecksumAsync(absoluteDepPath);
    }
    return await promiseProps(promises);
  }

  filterLocalDeps(name, deps) {
    // Change the working directory since npm-package-arg uses it when calling
    // path.resolve
    let originalCwd = process.cwd();
    let packagePath = path.resolve(this.root, name);
    process.chdir(packagePath);

    let localDeps = {};
    try {
      for (let [dep, version] of toPairsIn(deps)) {
        let descriptor = npmPackageArg(`${dep}@${version}`);
        if (descriptor.type === 'local') {
          localDeps[dep] = descriptor.spec;
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
    return localDeps;
  }

  async readPackageChecksumAsync(packagePath) {
    return new Promise((resolve, reject) => {
      let fileChecksumPromises = {};
      let fileListStream = fstreamNpm({ path: packagePath });

      fileListStream.on('child', entry => {
        let absoluteFilePath = entry.props.path;
        let relativeFilePath = path.relative(packagePath, absoluteFilePath);
        fileChecksumPromises[relativeFilePath] = this.readFileChecksumAsync(
          absoluteFilePath,
          'sha1'
        );
      });

      fileListStream.on('error', error => {
        fileListStream.removeAllListeners();
        reject(error);
      });

      fileListStream.on('end', async () => {
        fileListStream.removeAllListeners();
        let fileChecksums = await promiseProps(fileChecksumPromises);
        // Compute a stable hash of the hashes
        let hashStream = crypto.createHash('sha1');
        for (let checksum of sortBy(fileChecksums)) {
          hashStream.update(checksum, 'utf8');
        }
        resolve(hashStream.digest('hex'));
      });
    });
  }

  async readFileChecksumAsync(filePath, algorithm) {
    let contents = await fs.promise.readFile(filePath);
    let hashStream = crypto.createHash(algorithm);
    hashStream.update(contents);
    return hashStream.digest('hex');
  }

  async packageNeedsUpdateAsync(name, cacheBreaker, targetPackageState) {
    let packageState = get(this.state.packages, name);
    if (!packageState || packageState.cacheBreaker !== cacheBreaker) {
      return true;
    }

    let targetYarnLockfile = targetPackageState.yarnLockfile;
    if (targetYarnLockfile) {
      let installedYarnLockfile = packageState.yarnLockfile;
      if (!isEqual(targetYarnLockfile, installedYarnLockfile)) {
        return true;
      }
    } else {
      let targetShrinkwrap = targetPackageState.shrinkwrap;
      let installedShrinkwrap = packageState.shrinkwrap;
      if (targetShrinkwrap && !isEqual(targetShrinkwrap, installedShrinkwrap)) {
        return true;
      }

      let targetDeps = targetPackageState.dependencies;
      let installedDeps = packageState.dependencies;
      if (!isEqual(targetDeps, installedDeps)) {
        return true;
      }

      let targetUnversionedDepChecksums =
        targetPackageState.unversionedDependencyChecksums;
      let installedUnversionedDepChecksums =
        packageState.unversionedDependencyChecksums;
      if (
        !isEqual(
          targetUnversionedDepChecksums,
          installedUnversionedDepChecksums
        )
      ) {
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
    await fs.promise.unlink(stateFilename);
  }

  async isDirectoryAsync(directoryPath) {
    let stat;
    try {
      stat = await fs.promise.stat(directoryPath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return false;
      }
      throw e;
    }
    return stat.isDirectory();
  }
}
