#!/usr/bin/env node

'use strict';

let Hyperinstall = require('../lib/Hyperinstall');

let co = require('co');
let fs = require('fs');
let path = require('path');

const SCRIPT_FILE = 'npm-hyperinstall';

function createHyperinstallScriptAsync(root) {
  let script = `
    #!/bin/bash

    set -e

    ROOT=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
    cd $ROOT
    command -v hyperinstall >/dev/null 2>&1 || {
      echo >&2 "Hyperinstall is not in your PATH; run \"npm install -g hyperinstall\"";
      exit 1;
    }
    hyperinstall install $@
  `.replace(/^ +/gm, '').trimLeft();
  let filename = path.join(root, SCRIPT_FILE);
  return fs.promise.writeFile(filename, script, {
    encoding: 'utf8',
    mode: 0o755,
  });
}

function removeHyperinstallScriptAsync(root) {
  let filename = path.join(root, SCRIPT_FILE);
  return fs.promise.unlink(filename);
}

if (module === require.main) {
  let argv;
  let yargs = require('yargs')
    .usage('Usage: $0 <command> [options]')
    .help('help')
    .version(function() {
      return require('../package.json').version;
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
    );
  argv = yargs.argv;

  co(function*() {
    let command = argv._[0];
    if (command === 'init') {
      let root = argv._[1] || process.cwd();
      let hyperinstall = new Hyperinstall(root);

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
      let hyperinstall = new Hyperinstall(process.cwd());
      hyperinstall.forceInstallation = argv.force;
      yield hyperinstall.installAsync();
    } else if (command === 'clean') {
      let root = argv._[1] || process.cwd();
      let hyperinstall = new Hyperinstall(root);
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
