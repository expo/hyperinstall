#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import Hyperinstall from '../src/Hyperinstall.js';

const SCRIPT_FILE = 'npm-hyperinstall';

const USAGE = `Usage: hyperinstall <command> [options]

Commands:
  init [directory]   Creates a new Hyperinstall script in the current directory
                     (or an optionally specified directory)
  install            Runs "npm install" in each directory specified in
                     hyperinstall.json if the packages have changed since the
                     last time Hyperinstall ran
  clean [directory]  Removes the Hyperinstall script and
                     .hyperinstall-state.json file

Options for "install":
  -f, --force        Force all packages to be npm installed
  -c, --clean        Force removal of all packages' node_modules directories

Options:
  -h, --help         Show help
  -v, --version      Show the version number
`;

async function createHyperinstallScriptAsync(root) {
  let script = `
    #!/usr/bin/env bash

    set -e

    ROOT=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
    cd "$ROOT"
    command -v hyperinstall >/dev/null 2>&1 || {
      echo >&2 "Hyperinstall is not in your PATH; run \\"npm install -g hyperinstall\\"";
      exit 1;
    }
    hyperinstall install "$@"
  `
    .replace(/^ +/gm, '')
    .trimStart();
  let filename = path.join(root, SCRIPT_FILE);
  await fs.writeFile(filename, script, { encoding: 'utf8', mode: 0o755 });
  // writeFile's mode is subject to the process umask; the script must be executable
  await fs.chmod(filename, 0o755);
}

async function removeHyperinstallScriptAsync(root) {
  let filename = path.join(root, SCRIPT_FILE);
  await fs.rm(filename, { force: true });
}

async function readVersionAsync() {
  let packageJSONPath = new URL('../package.json', import.meta.url);
  let packageJSON = JSON.parse(await fs.readFile(packageJSONPath, 'utf8'));
  return packageJSON.version;
}

async function runAsync() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        force: { type: 'boolean', short: 'f', default: false },
        clean: { type: 'boolean', short: 'c', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    console.error(e.message);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  let { values, positionals } = parsed;
  if (values.version) {
    console.log(await readVersionAsync());
    return;
  }

  let command = positionals[0];
  if (!command || values.help) {
    console.log(USAGE);
    process.exitCode = command ? 0 : 1;
    return;
  }

  switch (command) {
    case 'init': {
      let root = positionals[1] ?? process.cwd();
      let hyperinstall = new Hyperinstall(root);
      await fs.mkdir(root, { recursive: true });
      await Promise.all([
        hyperinstall.createPackageListAsync(),
        createHyperinstallScriptAsync(root),
      ]);
      break;
    }
    case 'install': {
      let hyperinstall = new Hyperinstall(process.cwd());
      hyperinstall.forceInstallation = values.force;
      hyperinstall.forceClean = values.clean;
      await hyperinstall.installAsync();
      break;
    }
    case 'clean': {
      let root = positionals[1] ?? process.cwd();
      let hyperinstall = new Hyperinstall(root);
      await Promise.all([hyperinstall.cleanAsync(), removeHyperinstallScriptAsync(root)]);
      break;
    }
    default:
      console.error('Unknown command:', command);
      console.error(`\n${USAGE}`);
      process.exitCode = 1;
  }
}

try {
  await runAsync();
} catch (e) {
  console.error('Uncaught ' + e.stack);
  process.exitCode = 1;
}
