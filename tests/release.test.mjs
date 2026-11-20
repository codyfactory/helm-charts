import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = process.cwd();
const digest = 'a'.repeat(64);
const execution = `ghcr.io/codyfactory/cody-execution@sha256:${digest}`;
const native = `ghcr.io/codyfactory/cody-runtime-general@sha256:${'b'.repeat(64)}`;
const node = (script, args, cwd = root) => execFileSync(process.execPath, [resolve(root, script), ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('Stable and dev packages pin the selected images without changing source', () => {
  const before = readFileSync('charts/cody-execution/values.yaml');
  const temporary = mkdtempSync(join(tmpdir(), 'chart-release-'));
  try {
    for (const version of ['0.7.0-dev.184.1', '0.7.0']) {
      node('scripts/package.mjs', [version, execution, native, temporary]);
      const file = join(temporary, `cody-execution-${version}.tgz`);
      const metadata = execFileSync('helm', ['show', 'chart', file], { encoding: 'utf8' });
      assert.match(metadata, new RegExp(`^version: ${version.replaceAll('.', '\\.')}\\s*$`, 'm'));
      const values = execFileSync('helm', ['show', 'values', file], { encoding: 'utf8' });
      assert.ok(values.includes(`image: "${execution}"`));
      assert.ok(values.includes(`  image: "${native}"`));
    }
    assert.deepEqual(readFileSync('charts/cody-execution/values.yaml'), before);
    const invalid = spawnSync(process.execPath, ['scripts/package.mjs', '0.7.0;bad', execution, native, temporary]);
    assert.notEqual(invalid.status, 0);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('History gate rejects changed archives and removed index digests', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'chart-history-'));
  const git = args => execFileSync('git', args, { cwd: temporary, encoding: 'utf8' }).trim();
  try {
    cpSync('cody-execution-0.6.6.tgz', join(temporary, 'cody-execution-0.6.6.tgz'));
    cpSync('index.yaml', join(temporary, 'index.yaml'));
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Published']);
    const base = git(['rev-parse', 'HEAD']);
    node('scripts/history.mjs', [base], temporary);
    writeFileSync(join(temporary, 'index.yaml'), 'entries: {}');
    assert.throws(() => node('scripts/history.mjs', [base], temporary));
    cpSync('index.yaml', join(temporary, 'index.yaml'));
    writeFileSync(join(temporary, 'cody-execution-0.6.6.tgz'), 'changed');
    assert.throws(() => node('scripts/history.mjs', [base], temporary));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
