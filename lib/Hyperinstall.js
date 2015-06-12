/* @generated */var AwaitLock, CONFIG_FILE, Hyperinstall, STATE_FILE, _, childProcess, co, crypto, fs, fstreamNpm, npmPackageArg, path, rimraf, streamToPromise, util;

require('instapromise');

_ = require('lodash-node');

childProcess = require('child_process');

co = require('co');

crypto = require('crypto');

fs = require('fs');

fstreamNpm = require('fstream-npm');

npmPackageArg = require('npm-package-arg');

path = require('path');

rimraf = require('rimraf');

streamToPromise = require('stream-to-promise');

util = require('util');

AwaitLock = require('await-lock');

STATE_FILE = '.hyperinstall-state.json';

CONFIG_FILE = 'hyperinstall.json';

Hyperinstall = (function() {
  function Hyperinstall(root) {
    this.root = root;
    this.forceInstallation = false;
    this.state = {};
    this.updatedPackages = {};
    this.installLock = new AwaitLock;
  }

  Hyperinstall.prototype.cacheBreaker = 0;

  Hyperinstall.prototype.createPackageListAsync = co.wrap(function*() {
    var filename;
    filename = path.join(this.root, CONFIG_FILE);
    return fs.promise.writeFile(filename, '{\n}\n');
  });

  Hyperinstall.prototype.installAsync = co.wrap(function*() {
    var base, count, name, packageWord, packages, ref;
    ref = (yield [this.readInstallationStateAsync(), this.readPackageListAsync()]), this.state = ref[0], packages = ref[1];
    if (this.state.cacheBreaker !== this.cacheBreaker) {
      (yield _.map(packages, (function(_this) {
        return function(cacheBreaker, name) {
          var updatePackageAsync;
          updatePackageAsync = co.wrap(function*() {
            var deps, unversionedDepChecksums;
            deps = (yield _this.readPackageDepsAsync(name));
            unversionedDepChecksums = (yield _this.readUnversionedDepChecksumsAsync(name, deps));
            return _this.updatePackageAsync(name, cacheBreaker, deps, unversionedDepChecksums);
          });
          return updatePackageAsync();
        };
      })(this)));
    } else {
      (yield _.map(packages, (function(_this) {
        return function(cacheBreaker, name) {
          return _this.updatePackageIfNeededAsync(name, cacheBreaker);
        };
      })(this)));
    }
    if (!_.isEmpty(this.updatedPackages)) {
      count = _.keys(this.updatedPackages).length;
      packageWord = count === 1 ? 'package' : 'packages';
      console.log('Updated %d %s:', count, packageWord);
      for (name in this.updatedPackages) {
        console.log('  %s', name);
      }
    }
    this.state.cacheBreaker = this.cacheBreaker;
    if ((base = this.state).packages == null) {
      base.packages = {};
    }
    _.assign(this.state.packages, this.updatedPackages);
    for (name in this.state.packages) {
      if (!(name in packages)) {
        delete this.state.packages[name];
      }
    }
    return (yield this.writeInstallationStateAsync(this.state));
  });

  Hyperinstall.prototype.readInstallationStateAsync = co.wrap(function*() {
    var contents, e, filename;
    filename = path.join(this.root, STATE_FILE);
    try {
      contents = (yield fs.promise.readFile(filename, {
        encoding: 'utf8'
      }));
    } catch (_error) {
      e = _error;
      if (e.code === 'ENOENT') {
        return {};
      }
      throw e;
    }
    return JSON.parse(contents);
  });

  Hyperinstall.prototype.writeInstallationStateAsync = co.wrap(function*(state) {
    var contents, filename;
    contents = JSON.stringify(state);
    filename = path.join(this.root, STATE_FILE);
    return fs.promise.writeFile(filename, contents, {
      encoding: 'utf8'
    });
  });

  Hyperinstall.prototype.readPackageListAsync = co.wrap(function*() {
    var contents, e, filename;
    filename = path.join(this.root, CONFIG_FILE);
    try {
      contents = (yield fs.promise.readFile(filename, {
        encoding: 'utf8'
      }));
    } catch (_error) {
      e = _error;
      if (e.code === 'ENOENT') {
        console.warn('Specify the packages to install in ' + CONFIG_FILE + '.');
        return {};
      }
      throw e;
    }
    return JSON.parse(contents);
  });

  Hyperinstall.prototype.updatePackageIfNeededAsync = co.wrap(function*(name, cacheBreaker) {
    var deps, unversionedDepChecksums;
    deps = (yield this.readPackageDepsAsync(name));
    unversionedDepChecksums = (yield this.readUnversionedDepChecksumsAsync(name, deps));
    if (this.forceInstallation) {
      (yield this.removeNodeModulesDirAsync(name));
      return this.updatePackageAsync(name, cacheBreaker, deps, unversionedDepChecksums);
    } else {
      if (!this.packageNeedsUpdate(name, cacheBreaker, deps, unversionedDepChecksums)) {
        return;
      }
      return this.updatePackageAsync(name, cacheBreaker, deps, unversionedDepChecksums);
    }
  });

  Hyperinstall.prototype.updatePackageAsync = co.wrap(function*(name, cacheBreaker, deps, unversionedDepChecksums) {
    var packagePath;
    packagePath = path.resolve(this.root, name);
    (yield this.installLock.acquireAsync());
    console.log('Package "%s" has been updated; installing...', name);
    try {
      (yield this.promise.execNpmInstall(packagePath));
      console.log('Finished installing "%s"\n', name);
    } finally {
      this.installLock.release();
    }
    return this.updatedPackages[name] = {
      cacheBreaker: cacheBreaker,
      dependencies: deps,
      unversionedDependencyChecksums: unversionedDepChecksums
    };
  });

  Hyperinstall.prototype.removeNodeModulesDirAsync = co.wrap(function*(name) {
    var nodeModulesPath;
    nodeModulesPath = path.resolve(this.root, name, 'node_modules');
    (yield rimraf.promise(nodeModulesPath));
    return console.log('Removed node_modules for "%s"\n', name);
  });

  Hyperinstall.prototype.readPackageDepsAsync = co.wrap(function*(name) {
    var packageDeps, packageJSON, packageJSONPath, ref, ref1;
    packageJSONPath = path.resolve(this.root, name, 'package.json');
    packageJSON = (yield fs.promise.readFile(packageJSONPath, {
      encoding: 'utf8'
    }));
    packageJSON = JSON.parse(packageJSON);
    packageDeps = {};
    _.assign(packageDeps, (ref = packageJSON.dependencies) != null ? ref : {});
    return _.assign(packageDeps, (ref1 = packageJSON.devDependencies) != null ? ref1 : {});
  });

  Hyperinstall.prototype.readUnversionedDepChecksumsAsync = co.wrap(function*(name, deps) {
    var absoluteDepPath, dep, depPath, packagePath, promises, unversionedDeps;
    packagePath = path.resolve(this.root, name);
    unversionedDeps = this.filterLocalDeps(name, deps);
    promises = {};
    for (dep in unversionedDeps) {
      depPath = unversionedDeps[dep];
      absoluteDepPath = path.resolve(packagePath, depPath);
      promises[dep] = this.readPackageChecksumAsync(absoluteDepPath);
    }
    return (yield promises);
  });

  Hyperinstall.prototype.filterLocalDeps = function(name, deps) {
    var dep, descriptor, localDeps, originalCwd, packagePath, version;
    originalCwd = process.cwd();
    packagePath = path.resolve(this.root, name);
    process.chdir(packagePath);
    localDeps = {};
    try {
      for (dep in deps) {
        version = deps[dep];
        descriptor = npmPackageArg(dep + "@" + version);
        if (descriptor.type === 'local') {
          localDeps[dep] = descriptor.spec;
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
    return localDeps;
  };

  Hyperinstall.prototype.readPackageChecksumAsync = function(packagePath) {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        var fileChecksumPromises, fileListStream;
        fileChecksumPromises = {};
        fileListStream = fstreamNpm({
          path: packagePath
        });
        fileListStream.on('child', function(entry) {
          var absoluteFilePath, relativeFilePath;
          absoluteFilePath = entry.props.path;
          relativeFilePath = path.relative(packagePath, absoluteFilePath);
          return fileChecksumPromises[relativeFilePath] = _this.readFileChecksumAsync(absoluteFilePath, 'sha1');
        });
        fileListStream.on('error', function(error) {
          fileListStream.removeAllListeners();
          return reject(error);
        });
        return fileListStream.on('end', function() {
          fileListStream.removeAllListeners();
          return resolve(co(function*() {
            var checksum, fileChecksums, hashStream, i, len, ref;
            fileChecksums = (yield fileChecksumPromises);
            hashStream = crypto.createHash('sha1');
            ref = _.sortBy(fileChecksums);
            for (i = 0, len = ref.length; i < len; i++) {
              checksum = ref[i];
              hashStream.update(checksum, 'utf8');
            }
            return hashStream.digest('hex');
          }));
        });
      };
    })(this));
  };

  Hyperinstall.prototype.readFileChecksumAsync = function*(filePath, algorithm) {
    var contents, hashStream;
    contents = (yield fs.promise.readFile(filePath));
    hashStream = crypto.createHash(algorithm);
    hashStream.update(contents);
    return hashStream.digest('hex');
  };

  Hyperinstall.prototype.packageNeedsUpdate = function(name, cacheBreaker, deps, unversionedDepChecksums) {
    var installedDeps, installedUnversionedDepChecksums, packageState, ref;
    packageState = (ref = this.state.packages) != null ? ref[name] : void 0;
    if (!packageState) {
      return true;
    }
    if (packageState.cacheBreaker !== cacheBreaker) {
      return true;
    }
    installedDeps = packageState.dependencies;
    if (!_.isEqual(deps, installedDeps)) {
      return true;
    }
    installedUnversionedDepChecksums = packageState.unversionedDependencyChecksums;
    return !_.isEqual(unversionedDepChecksums, installedUnversionedDepChecksums);
  };

  Hyperinstall.prototype.execNpmInstall = function(packagePath, callback) {
    var child;
    child = childProcess.spawn('npm', ['install'], {
      cwd: packagePath,
      stdio: 'inherit'
    });
    child.on('error', function(err) {
      child.removeAllListeners();
      return callback(err);
    });
    return child.on('exit', function(code, signal) {
      var err, message;
      child.removeAllListeners();
      if (code) {
        message = util.format('npm install failed in %s', packagePath);
        err = new Error(message);
        err.errno = code;
        err.code = signal;
      }
      return callback(err, code);
    });
  };

  Hyperinstall.prototype.cleanAsync = co.wrap(function*() {
    var stateFilename;
    stateFilename = path.join(this.root, STATE_FILE);
    return fs.promise.unlink(stateFilename);
  });

  return Hyperinstall;

})();

module.exports = Hyperinstall;
