import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI_PATH = new URL('../bin/cli.js', import.meta.url).pathname;
const PACKAGE_JSON_PATH = new URL('../package.json', import.meta.url);

let tempDirs = [];

async function makeTempDirAsync() {
  let dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-cli-'));
  tempDirs.push(dir);
  return dir;
}

function runCliAsync(args, options) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], options);
}

after(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('cli', () => {
  it('prints the version', async () => {
    let { version } = JSON.parse(await fs.readFile(PACKAGE_JSON_PATH, 'utf8'));
    let { stdout } = await runCliAsync(['--version']);
    assert.equal(stdout.trim(), version);
  });

  it('prints usage for --help', async () => {
    let { stdout } = await runCliAsync(['--help', 'install']);
    assert.match(stdout, /Usage: hyperinstall <command> \[options\]/);
  });

  it('exits with an error for an unknown command', async () => {
    await assert.rejects(runCliAsync(['bogus']), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Unknown command: bogus/);
      return true;
    });
  });

  it('exits with an error for an unknown option', async () => {
    await assert.rejects(runCliAsync(['install', '--nope']), error => {
      assert.equal(error.code, 1);
      return true;
    });
  });

  it('init creates hyperinstall.json and an executable script', async () => {
    let root = await makeTempDirAsync();
    await runCliAsync(['init', root]);

    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, 'hyperinstall.json'), 'utf8')),
      {}
    );
    let scriptPath = path.join(root, 'npm-hyperinstall');
    let script = await fs.readFile(scriptPath, 'utf8');
    assert.match(script, /^#!\/usr\/bin\/env bash/);
    assert.match(script, /hyperinstall install "\$@"/);
    let stats = await fs.stat(scriptPath);
    assert.equal(stats.mode & 0o111, 0o111);
  });

  it('init defaults to the current directory, and clean removes what it created', async () => {
    let root = await makeTempDirAsync();
    await runCliAsync(['init'], { cwd: root });
    await runCliAsync(['install'], { cwd: root });
    await fs.stat(path.join(root, '.hyperinstall-state.json'));

    await runCliAsync(['clean'], { cwd: root });

    await assert.rejects(fs.stat(path.join(root, '.hyperinstall-state.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, 'npm-hyperinstall')), { code: 'ENOENT' });
  });
});
