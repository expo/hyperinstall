'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.execYarnInstallAsync = execYarnInstallAsync;

var _exec = require('./exec');

function execYarnInstallAsync(packagePath) {
  return (0, _exec.execAsync)('yarn', [], { cwd: packagePath, stdio: 'inherit' });
}