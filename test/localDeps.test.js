import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterLocalDeps, getLocalDepPath } from '../src/localDeps.js';

describe('getLocalDepPath', () => {
  it('recognizes file: specifiers', () => {
    assert.equal(getLocalDepPath('file:../shared'), '../shared');
    assert.equal(getLocalDepPath('file:/opt/shared'), '/opt/shared');
    assert.equal(getLocalDepPath('file:./pkg.tgz'), './pkg.tgz');
  });

  it('recognizes bare paths', () => {
    assert.equal(getLocalDepPath('./shared'), './shared');
    assert.equal(getLocalDepPath('../../shared'), '../../shared');
    assert.equal(getLocalDepPath('/opt/shared'), '/opt/shared');
    assert.equal(getLocalDepPath('~/shared'), '~/shared');
    assert.equal(getLocalDepPath('C:\\shared'), 'C:\\shared');
  });

  it('rejects registry, git, and URL specifiers', () => {
    for (let version of [
      '^1.0.0',
      '1.2.3',
      'latest',
      '*',
      'npm:other@^1.0.0',
      'github:expo/hyperinstall',
      'expo/hyperinstall#main',
      'git+ssh://git@github.com/expo/hyperinstall.git',
      'https://example.com/pkg.tgz',
      '',
    ]) {
      assert.equal(getLocalDepPath(version), null, `expected ${version} to not be local`);
    }
  });

  it('ignores non-string versions', () => {
    assert.equal(getLocalDepPath(undefined), null);
    assert.equal(getLocalDepPath(null), null);
  });
});

describe('filterLocalDeps', () => {
  it('keeps only local dependencies and unwraps the file: prefix', () => {
    assert.deepEqual(
      filterLocalDeps({
        lodash: '^4.17.21',
        shared: 'file:../shared',
        tools: './tools',
      }),
      { shared: '../shared', tools: './tools' }
    );
  });
});
