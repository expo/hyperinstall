'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

require('instapromise');

var _awaitLock = require('await-lock');

var _awaitLock2 = _interopRequireDefault(_awaitLock);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _fstreamNpm = require('fstream-npm');

var _fstreamNpm2 = _interopRequireDefault(_fstreamNpm);

var _get = require('lodash/get');

var _get2 = _interopRequireDefault(_get);

var _isEmpty = require('lodash/isEmpty');

var _isEmpty2 = _interopRequireDefault(_isEmpty);

var _isEqual = require('lodash/isEqual');

var _isEqual2 = _interopRequireDefault(_isEqual);

var _map = require('lodash/map');

var _map2 = _interopRequireDefault(_map);

var _sortBy = require('lodash/sortBy');

var _sortBy2 = _interopRequireDefault(_sortBy);

var _toPairsIn = require('lodash/toPairsIn');

var _toPairsIn2 = _interopRequireDefault(_toPairsIn);

var _npmPackageArg = require('npm-package-arg');

var _npmPackageArg2 = _interopRequireDefault(_npmPackageArg);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _rimraf = require('rimraf');

var _rimraf2 = _interopRequireDefault(_rimraf);

var _promiseProps = require('@exponent/promise-props');

var _promiseProps2 = _interopRequireDefault(_promiseProps);

var _npm = require('./npm');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { return step("next", value); }, function (err) { return step("throw", err); }); } } return step("next"); }); }; }

const STATE_FILE = '.hyperinstall-state.json';
const CONFIG_FILE = 'hyperinstall.json';

// Global cache breaker to force updating all packages
const CACHE_BREAKER = 0;

class Hyperinstall {
  constructor(root) {
    this.root = root;
    this.forceInstallation = false;
    this.state = {};
    this.updatedPackages = {};
    this.installLock = new _awaitLock2.default();
  }

  createPackageListAsync() {
    let filename = _path2.default.join(this.root, CONFIG_FILE);
    return _fs2.default.promise.writeFile(filename, '{\n}\n');
  }

  installAsync() {
    var _this = this;

    return _asyncToGenerator(function* () {
      var _ref = yield Promise.all([_this.readInstallationStateAsync(), _this.readPackageListAsync()]);

      var _ref2 = _slicedToArray(_ref, 2);

      let state = _ref2[0];
      let packages = _ref2[1];

      _this.state = state;

      if (state.cacheBreaker !== CACHE_BREAKER) {
        yield Promise.all((0, _map2.default)(packages, (() => {
          var ref = _asyncToGenerator(function* (cacheBreaker, name) {
            let packageInstallationState = _this.readPackageInstallationState(name);
            yield _this.updatePackageAsync(name, cacheBreaker, packageInstallationState);
          });

          return function (_x, _x2) {
            return ref.apply(this, arguments);
          };
        })()));
      } else {
        yield Promise.all((0, _map2.default)(packages, (() => {
          var ref = _asyncToGenerator(function* (cacheBreaker, name) {
            yield _this.updatePackageIfNeededAsync(name, cacheBreaker);
          });

          return function (_x3, _x4) {
            return ref.apply(this, arguments);
          };
        })()));
      }

      if (!(0, _isEmpty2.default)(_this.updatedPackages)) {
        let packageNames = Object.keys(_this.updatedPackages);
        let count = packageNames.length;
        let packageWord = count === 1 ? 'package' : 'packages';
        console.log('Updated %d %s:', count, packageWord);
        for (let name of packageNames) {
          console.log('  %s', name);
        }
      }

      // Update the installation state
      state.cacheBreaker = CACHE_BREAKER;
      state.packages = Object.assign({}, state.packages, _this.updatedPackages);
      for (let name of Object.keys(state.packages)) {
        if (!packages.hasOwnProperty(name)) {
          delete state.packages[name];
        }
      }
      yield _this.writeInstallationStateAsync(state);
    })();
  }

  readInstallationStateAsync() {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      let filename = _path2.default.join(_this2.root, STATE_FILE);
      let contents;
      try {
        contents = yield _fs2.default.promise.readFile(filename, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') {
          return {};
        }
        throw e;
      }
      return JSON.parse(contents);
    })();
  }

  writeInstallationStateAsync(state) {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      let contents = JSON.stringify(state, null, 2);
      let filename = _path2.default.join(_this3.root, STATE_FILE);
      yield _fs2.default.promise.writeFile(filename, contents, 'utf8');
    })();
  }

  readPackageListAsync() {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      let filename = _path2.default.join(_this4.root, CONFIG_FILE);
      let contents;
      try {
        contents = yield _fs2.default.promise.readFile(filename, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.warn(`Specify the packages to install in ${ CONFIG_FILE }.`);
          return {};
        }
        throw e;
      }
      return JSON.parse(contents);
    })();
  }

  readPackageInstallationState(name) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      var _ref3 = yield Promise.all([_this5.readPackageDepsAsync(name), _this5.readShrinkwrapAsync(name)]);

      var _ref4 = _slicedToArray(_ref3, 2);

      let deps = _ref4[0];
      let shrinkwrap = _ref4[1];

      let unversionedDepChecksums = yield _this5.readUnversionedDepChecksumsAsync(name, deps);
      return {
        dependencies: deps,
        unversionedDependencyChecksums: unversionedDepChecksums,
        shrinkwrap
      };
    })();
  }

  updatePackageIfNeededAsync(name, cacheBreaker) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      let packageInstallationState = yield _this6.readPackageInstallationState(name);
      if (_this6.forceInstallation) {
        yield _this6.removeNodeModulesDirAsync(name);
        yield _this6.updatePackageAsync(name, cacheBreaker, packageInstallationState);
      } else if (_this6.packageNeedsUpdate(name, cacheBreaker, packageInstallationState)) {
        yield _this6.updatePackageAsync(name, cacheBreaker, packageInstallationState);
      }
    })();
  }

  updatePackageAsync(name, cacheBreaker, packageInstallationState) {
    var _this7 = this;

    return _asyncToGenerator(function* () {
      let packagePath = _path2.default.resolve(_this7.root, name);
      yield _this7.installLock.acquireAsync();
      console.log('Package "%s" has been updated; installing...', name);
      try {
        yield (0, _npm.execNpmInstallAsync)(packagePath);
        console.log('Finished installing "%s"\n', name);
      } finally {
        _this7.installLock.release();
      }

      _this7.updatedPackages[name] = _extends({}, packageInstallationState, {
        cacheBreaker
      });
    })();
  }

  removeNodeModulesDirAsync(name) {
    var _this8 = this;

    return _asyncToGenerator(function* () {
      let nodeModulesPath = _path2.default.resolve(_this8.root, name, 'node_modules');
      yield _rimraf2.default.promise(nodeModulesPath);
      console.log('Removed node_modules for "%s"\n', name);
    })();
  }

  readShrinkwrapAsync(name) {
    var _this9 = this;

    return _asyncToGenerator(function* () {
      let shrinkwrapJSONPath = _path2.default.resolve(_this9.root, name, 'npm-shrinkwrap.json');
      let shrinkwrapJSON;
      try {
        shrinkwrapJSON = yield _fs2.default.promise.readFile(shrinkwrapJSONPath, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') {
          return undefined;
        }
        throw e;
      }
      return JSON.parse(shrinkwrapJSON);
    })();
  }

  readPackageDepsAsync(name) {
    var _this10 = this;

    return _asyncToGenerator(function* () {
      let packageJSONPath = _path2.default.resolve(_this10.root, name, 'package.json');
      let packageJSON = yield _fs2.default.promise.readFile(packageJSONPath, 'utf8');
      packageJSON = JSON.parse(packageJSON);

      let packageDeps = {};
      Object.assign(packageDeps, packageJSON.dependencies);
      Object.assign(packageDeps, packageJSON.devDependencies);
      return packageDeps;
    })();
  }

  readUnversionedDepChecksumsAsync(name, deps) {
    var _this11 = this;

    return _asyncToGenerator(function* () {
      let packagePath = _path2.default.resolve(_this11.root, name);
      let unversionedDeps = _this11.filterLocalDeps(name, deps);
      let promises = {};
      for (let _ref5 of (0, _toPairsIn2.default)(unversionedDeps)) {
        var _ref6 = _slicedToArray(_ref5, 2);

        let dep = _ref6[0];
        let depPath = _ref6[1];

        let absoluteDepPath = _path2.default.resolve(packagePath, depPath);
        promises[dep] = _this11.readPackageChecksumAsync(absoluteDepPath);
      }
      return yield (0, _promiseProps2.default)(promises);
    })();
  }

  filterLocalDeps(name, deps) {
    // Change the working directory since npm-package-arg uses it when calling
    // path.resolve
    let originalCwd = process.cwd();
    let packagePath = _path2.default.resolve(this.root, name);
    process.chdir(packagePath);

    let localDeps = {};
    try {
      for (let _ref7 of (0, _toPairsIn2.default)(deps)) {
        var _ref8 = _slicedToArray(_ref7, 2);

        let dep = _ref8[0];
        let version = _ref8[1];

        let descriptor = (0, _npmPackageArg2.default)(`${ dep }@${ version }`);
        if (descriptor.type === 'local') {
          localDeps[dep] = descriptor.spec;
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
    return localDeps;
  }

  readPackageChecksumAsync(packagePath) {
    var _this12 = this;

    return _asyncToGenerator(function* () {
      return new Promise(function (resolve, reject) {
        let fileChecksumPromises = {};
        let fileListStream = (0, _fstreamNpm2.default)({ path: packagePath });

        fileListStream.on('child', function (entry) {
          let absoluteFilePath = entry.props.path;
          let relativeFilePath = _path2.default.relative(packagePath, absoluteFilePath);
          fileChecksumPromises[relativeFilePath] = _this12.readFileChecksumAsync(absoluteFilePath, 'sha1');
        });

        fileListStream.on('error', function (error) {
          fileListStream.removeAllListeners();
          reject(error);
        });

        fileListStream.on('end', _asyncToGenerator(function* () {
          fileListStream.removeAllListeners();
          let fileChecksums = yield (0, _promiseProps2.default)(fileChecksumPromises);
          // Compute a stable hash of the hashes
          let hashStream = _crypto2.default.createHash('sha1');
          for (let checksum of (0, _sortBy2.default)(fileChecksums)) {
            hashStream.update(checksum, 'utf8');
          }
          resolve(hashStream.digest('hex'));
        }));
      });
    })();
  }

  readFileChecksumAsync(filePath, algorithm) {
    return _asyncToGenerator(function* () {
      let contents = yield _fs2.default.promise.readFile(filePath);
      let hashStream = _crypto2.default.createHash(algorithm);
      hashStream.update(contents);
      return hashStream.digest('hex');
    })();
  }

  packageNeedsUpdate(name, cacheBreaker, deps, unversionedDepChecksums, shrinkwrap) {
    let packageState = (0, _get2.default)(this.state.packages, name);
    if (!packageState || packageState.cacheBreaker !== cacheBreaker) {
      return true;
    }

    let installedShrinkwrap = packageState.shrinkwrap;
    if (shrinkwrap && (0, _isEqual2.default)(shrinkwrap, installedShrinkwrap)) {
      return true;
    }

    let installedDeps = packageState.dependencies;
    if (!(0, _isEqual2.default)(deps, installedDeps)) {
      return true;
    }

    let installedUnversionedDepChecksums = packageState.unversionedDependencyChecksums;
    return !(0, _isEqual2.default)(unversionedDepChecksums, installedUnversionedDepChecksums);
  }

  cleanAsync() {
    var _this13 = this;

    return _asyncToGenerator(function* () {
      let stateFilename = _path2.default.join(_this13.root, STATE_FILE);
      yield _fs2.default.promise.unlink(stateFilename);
    })();
  }
}
exports.default = Hyperinstall;
module.exports = exports['default'];