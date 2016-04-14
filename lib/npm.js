'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.execNpmInstallAsync = execNpmInstallAsync;
exports.execNpmInstall = execNpmInstall;

var _child_process = require('child_process');

var _child_process2 = _interopRequireDefault(_child_process);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function execNpmInstallAsync(packagePath) {
  return new Promise((resolve, reject) => {
    execNpmInstall(packagePath, (error, code) => {
      if (error) {
        reject(error);
      } else {
        resolve(code);
      }
    });
  });
}

function execNpmInstall(packagePath, callback) {
  let child = _child_process2.default.spawn('npm', ['install'], {
    cwd: packagePath,
    stdio: 'inherit'
  });

  child.on('error', error => {
    child.removeAllListeners();
    callback(error);
  });

  child.on('exit', (code, signal) => {
    child.removeAllListeners();
    let error;
    if (code) {
      let message = _util2.default.format('npm install failed in %s', packagePath);
      error = new Error(message);
      error.errno = code;
      error.code = signal;
    }
    callback(error, code);
  });
}