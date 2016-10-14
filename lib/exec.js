'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.execAsync = execAsync;
exports.exec = exec;

var _child_process = require('child_process');

var _child_process2 = _interopRequireDefault(_child_process);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function execAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    exec(command, args, options, (error, code) => {
      if (error) {
        reject(error);
      } else {
        resolve(code);
      }
    });
  });
}

function exec(command, args, options, callback) {
  let child = _child_process2.default.spawn(command, args, options);

  child.on('error', error => {
    child.removeAllListeners();
    callback(error);
  });

  child.on('exit', (code, signal) => {
    child.removeAllListeners();
    let error;
    if (code) {
      let message = _util2.default.format('%s failed%s', [command, ...args].join(' '), options.cwd ? ` in ${ options.cwd }` : '');
      error = new Error(message);
      error.errno = code;
      error.code = signal;
    }
    callback(error, code);
  });
}