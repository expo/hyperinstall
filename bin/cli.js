#!/usr/bin/env node

'use strict';

var Hyperinstall = require('../lib/Hyperinstall');

var co = require('co');
var fs = require('fs');
var path = require('path');

var SCRIPT_FILE = 'npm-hyperinstall';

function createHyperinstallScriptAsync(root) {
  var script = `
    #!/bin/bash

    set -e

    ROOT=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
    cd $ROOT
    hyperinstall install $@
  `.replace(/^ +/gm, '').trimLeft();
  var filename = path.join(root, SCRIPT_FILE);
  return fs.promise.writeFile(filename, script, {
    encoding: 'utf8',
    mode: 0o755,
  });
}

function removeHyperinstallScriptAsync(root) {
  var filename = path.join(root, SCRIPT_FILE);
  return fs.promise.unlink(filename);
}

if (module === require.main) {
  var yargs = require('yargs')
    .usage('Usage: $0 <command> [options]')
    .help('help')
    .version(function() {
      return require('./package.json').version;
    })
    .command(
      'init',
      'Creates a new Hyperinstall script in the current directory (or an ' +
        'optionally specified directory)',
      function(yargs) {
        argv = yargs
          .help('help')
          .usage('Usage: $0 init [directory]')
          .argv;
      }
    )
    .command(
      'install',
      'Runs "npm install" in each directory specified in hyperinstall.json ' +
        'if the packages have changed since the last time Hyperinstall ran',
      function(yargs) {
        argv = yargs
          .help('help')
          .usage('Usage: $0 install')
          .option('f', {
            alias: 'force',
            describe: 'Force all packages to be installed by first removing ' +
              'all "node_modules" directories',
            type: 'boolean',
          })
          .argv;
      }
    )
    .command(
      'clean',
      'Removes the Hyperinstall script and .hyperinstall-state.json file',
      function(yargs) {
        argv = yargs
          .help('help')
          .usage('Usage: $0 clean [directory]')
          .argv;
      }
    )
  var argv = yargs.argv;

  co(function* () {
    var command = argv._[0];
    if (command === 'init') {
      var root = argv._[1] || process.cwd();
      var hyperinstall = new Hyperinstall(root);

      try {
        yield fs.promise.mkdir(root);
      } catch (e) {
        if (e.code !== 'EEXIST') {
          throw e;
        }
      }

      yield Promise.all([
        hyperinstall.createPackageListAsync(),
        createHyperinstallScriptAsync(root),
      ]);
    } else if (command === 'install') {
      var hyperinstall = new Hyperinstall(process.cwd());
      hyperinstall.forceInstallation = argv.force;
      yield hyperinstall.installAsync();
    } else if (command === 'clean') {
      var root = argv._[1] || process.cwd();
      var hyperinstall = new Hyperinstall(root);
      yield Promise.all([
        hyperinstall.cleanAsync(),
        removeHyperinstallScriptAsync(root),
      ]);
    } else if (!command) {
      console.log(yargs.help());
    } else {
      console.error('Unknown command:', command);
      process.exit(1);
    }
  }).catch(function(err) {
    console.error('Uncaught ' + err.stack);
  });
}
