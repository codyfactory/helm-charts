import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { nextVersion, appendEntry } from '../scripts/publish.mjs';

const root = process.cwd();
test('Chart versions advance independently and retain old index entries', () => {
  const index = readFileSync('index.yaml', 'utf8');
  assert.equal(nextVersion(index, '0.6.9'), '0.6.10');
  assert.equal(nextVersion(index, '1.0.0'), '1.0.0');
  const generated = 'apiVersion: v1\nentries:\n  cody-execution:\n  - version: 0.6.10\n    digest: abc\ngenerated: now\n';
  const updated = appendEntry(index, generated);
  assert.ok(updated.includes('  - version: 0.6.10\n    digest: abc\n'));
  assert.equal(updated.replace('  - version: 0.6.10\n    digest: abc\n', ''), index);
});

test('Verified source publishes once; generated commits and stale verification do not publish', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chart-publication-test-'));
  const bare = join(directory, 'remote.git'), local = join(directory, 'checkout');
  const execute = (cmd, args, cwd = directory) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = args => execute('git', args, local);
  const publish = sha => execute(process.execPath, [resolve(root, 'scripts/publish.mjs'), sha], local);
  try {
    execute('git', ['init', '--bare', '-q', bare]);
    execute('git', ['clone', '-q', bare, local]);
    git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
    git(['checkout', '-b', 'main']);
    cpSync('charts', join(local, 'charts'), { recursive: true });
    cpSync('index.yaml', join(local, 'index.yaml'));
    git(['add', '.']); git(['commit', '-qm', 'Initial']); git(['push', '-u', 'origin', 'main']);
    git(['checkout', '-b', 'source-change']);
    writeFileSync(join(local, 'charts/cody-execution/values.yaml'), readFileSync(join(local, 'charts/cody-execution/values.yaml'), 'utf8') + '\n');
    git(['add', '.']); git(['commit', '-qm', 'Chart source']);
    git(['checkout', 'main']); git(['merge', '--no-ff', '-m', 'Merge chart source', 'source-change']); git(['push']);
    const verified = git(['rev-parse', 'HEAD']);
    assert.match(publish(verified), /Published chart 0.6.10/);
    const published = git(['rev-parse', 'HEAD']);
    assert.match(publish(verified), /already published/);
    assert.equal(git(['rev-parse', 'HEAD']), published);
    assert.match(publish(published), /No chart source changes/);
    assert.equal(git(['rev-parse', 'HEAD']), published);
    const archive = join(local, 'cody-execution-0.6.10.tgz');
    assert.equal(execute('helm', ['show', 'values', archive]), execute('helm', ['show', 'values', resolve(root, 'charts/cody-execution')]));
    writeFileSync(join(local, 'charts/cody-execution/values.yaml'), readFileSync(join(local, 'charts/cody-execution/values.yaml'), 'utf8') + '\n');
    git(['add', '.']); git(['commit', '-qm', 'Next source']); git(['push', 'origin', 'HEAD:main']);
    const stale = git(['rev-parse', 'HEAD']);
    writeFileSync(join(local, 'charts/cody-execution/values.yaml'), readFileSync(join(local, 'charts/cody-execution/values.yaml'), 'utf8') + '\n');
    git(['add', '.']); git(['commit', '-qm', 'Newer source']); git(['push', 'origin', 'HEAD:main']);
    assert.match(publish(stale), /Newer chart source/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
