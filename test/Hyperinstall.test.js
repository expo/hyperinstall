import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

import Hyperinstall from '../src/Hyperinstall.js';

const STATE_FILE = '.hyperinstall-state.json';

let tempDirs = [];

class TestHyperinstall extends Hyperinstall {
  installs = [];

  async execInstallAsync(packagePath, useYarn) {
    this.installs.push({ packagePath, useYarn });
    // Pretend the package manager created node_modules
    await fs.mkdir(path.join(packagePath, 'node_modules'), { recursive: true });
  }
}

async function makeProjectAsync(packages, config) {
  let root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-'));
  tempDirs.push(root);
  for (let [name, files] of Object.entries(packages)) {
    for (let [file, contents] of Object.entries(files)) {
      let filePath = path.join(root, name, file);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);
    }
  }
  await fs.writeFile(
    path.join(root, 'hyperinstall.json'),
    JSON.stringify(config ?? Object.fromEntries(Object.keys(packages).map(name => [name, 0])))
  );
  return root;
}

function packageJSON(fields) {
  return JSON.stringify({ name: 'test', version: '1.0.0', ...fields });
}

async function installAsync(root, configure) {
  let hyperinstall = new TestHyperinstall(root);
  configure?.(hyperinstall);
  await hyperinstall.installAsync();
  return hyperinstall;
}

async function readStateAsync(root) {
  return JSON.parse(await fs.readFile(path.join(root, STATE_FILE), 'utf8'));
}

beforeEach(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

after(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('Hyperinstall', () => {
  it('installs every package on the first run and records the state', async () => {
    let root = await makeProjectAsync({
      a: { 'package.json': packageJSON({ dependencies: { lodash: '^4.0.0' } }) },
      b: { 'package.json': packageJSON({}) },
    });

    let hyperinstall = await installAsync(root);

    assert.deepEqual(
      hyperinstall.installs.map(install => path.basename(install.packagePath)).sort(),
      ['a', 'b']
    );
    let state = await readStateAsync(root);
    assert.deepEqual(Object.keys(state.packages).sort(), ['a', 'b']);
    assert.deepEqual(state.packages.a.dependencies, { lodash: '^4.0.0' });
  });

  it('does nothing on a second run when nothing changed', async () => {
    let root = await makeProjectAsync({
      a: { 'package.json': packageJSON({ dependencies: { lodash: '^4.0.0' } }) },
    });

    await installAsync(root);
    let second = await installAsync(root);

    assert.deepEqual(second.installs, []);
  });

  it('reinstalls when a dependency changes', async () => {
    let root = await makeProjectAsync({
      a: { 'package.json': packageJSON({ dependencies: { lodash: '^4.0.0' } }) },
    });
    await installAsync(root);

    await fs.writeFile(
      path.join(root, 'a/package.json'),
      packageJSON({ dependencies: { lodash: '^4.17.21' } })
    );
    let second = await installAsync(root);

    assert.equal(second.installs.length, 1);
  });

  it('reinstalls when node_modules is missing', async () => {
    let root = await makeProjectAsync({ a: { 'package.json': packageJSON({}) } });
    await installAsync(root);

    await fs.rm(path.join(root, 'a/node_modules'), { recursive: true, force: true });
    let second = await installAsync(root);

    assert.equal(second.installs.length, 1);
  });

  it('reinstalls when the cache breaker in hyperinstall.json changes', async () => {
    let root = await makeProjectAsync({ a: { 'package.json': packageJSON({}) } });
    await installAsync(root);

    await fs.writeFile(path.join(root, 'hyperinstall.json'), JSON.stringify({ a: 1 }));
    let second = await installAsync(root);

    assert.equal(second.installs.length, 1);
  });

  it('uses yarn when the package has a yarn.lock and tracks the lockfile', async () => {
    let root = await makeProjectAsync({
      a: { 'package.json': packageJSON({}), 'yarn.lock': '# yarn lockfile v1\n' },
    });

    let first = await installAsync(root);
    assert.deepEqual(
      first.installs.map(install => install.useYarn),
      [true]
    );
    assert.deepEqual((await installAsync(root)).installs, []);

    await fs.writeFile(path.join(root, 'a/yarn.lock'), '# yarn lockfile v1\n# changed\n');
    assert.equal((await installAsync(root)).installs.length, 1);
  });

  it('reinstalls when a local file: dependency changes', async () => {
    let root = await makeProjectAsync(
      {
        a: { 'package.json': packageJSON({ dependencies: { shared: 'file:../shared' } }) },
        shared: {
          'package.json': packageJSON({ name: 'shared' }),
          'index.js': 'export default 1;',
        },
      },
      { a: 0 }
    );

    await installAsync(root);
    assert.deepEqual((await installAsync(root)).installs, []);

    await fs.writeFile(path.join(root, 'shared/index.js'), 'export default 2;');
    assert.equal((await installAsync(root)).installs.length, 1);
  });

  it('does not reinstall when only node_modules of a local dependency changes', async () => {
    let root = await makeProjectAsync(
      {
        a: { 'package.json': packageJSON({ dependencies: { shared: 'file:../shared' } }) },
        shared: { 'package.json': packageJSON({ name: 'shared' }) },
      },
      { a: 0 }
    );
    await installAsync(root);

    await fs.mkdir(path.join(root, 'shared/node_modules/dep'), { recursive: true });
    await fs.writeFile(path.join(root, 'shared/node_modules/dep/index.js'), 'noise');

    assert.deepEqual((await installAsync(root)).installs, []);
  });

  it('honors --force and --clean', async () => {
    let root = await makeProjectAsync({ a: { 'package.json': packageJSON({}) } });
    await installAsync(root);
    await fs.writeFile(path.join(root, 'a/node_modules/marker'), 'x');

    let forced = await installAsync(root, h => {
      h.forceInstallation = true;
      h.forceClean = true;
    });

    assert.equal(forced.installs.length, 1);
    await assert.rejects(fs.stat(path.join(root, 'a/node_modules/marker')), { code: 'ENOENT' });
  });

  it('prunes packages that are no longer in hyperinstall.json', async () => {
    let root = await makeProjectAsync({
      a: { 'package.json': packageJSON({}) },
      b: { 'package.json': packageJSON({}) },
    });
    await installAsync(root);

    await fs.writeFile(path.join(root, 'hyperinstall.json'), JSON.stringify({ a: 0 }));
    await installAsync(root);

    assert.deepEqual(Object.keys((await readStateAsync(root)).packages), ['a']);
  });

  it('warns and does nothing when hyperinstall.json is missing', async () => {
    let root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-'));
    tempDirs.push(root);

    let hyperinstall = await installAsync(root);

    assert.deepEqual(hyperinstall.installs, []);
    assert.deepEqual(await readStateAsync(root), { cacheBreaker: 0, packages: {} });
  });

  it('creates an empty package list and removes the state file', async () => {
    let root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperinstall-'));
    tempDirs.push(root);
    let hyperinstall = new TestHyperinstall(root);

    await hyperinstall.createPackageListAsync();
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, 'hyperinstall.json'), 'utf8')),
      {}
    );

    await hyperinstall.installAsync();
    await hyperinstall.cleanAsync();
    await assert.rejects(fs.stat(path.join(root, STATE_FILE)), { code: 'ENOENT' });
  });
});
