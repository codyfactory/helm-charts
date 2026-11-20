import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
assert.match(base ?? '', /^[0-9a-f]{40}$/, 'An explicit base commit is required');
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', base], { encoding: 'utf8' }).trim().split('\n');
for (const file of files.filter(name => /^cody-execution-.*\.tgz$/.test(name))) {
  const original = execFileSync('git', ['show', `${base}:${file}`]);
  assert.deepEqual(readFileSync(file), original, `Published archive changed: ${file}`);
  const digest = createHash('sha256').update(original).digest('hex');
  assert.ok(readFileSync('index.yaml', 'utf8').includes(`digest: ${digest}`), `Published digest removed: ${file}`);
}
console.log('Published archives and index digests preserved');
