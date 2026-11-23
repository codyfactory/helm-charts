import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function receipt(plan, env = process.env, request = fetch) {
  assert.match(plan.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  for (const field of ['sourceCommit', 'publicationCommit']) assert.match(plan[field], /^[a-f0-9]{40}$/);
  for (const name of ['VERIFY_RUN_ID', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(env[name], /^[1-9]\d*$/);
  assert.equal(plan.archive, `cody-execution-${plan.version}.tgz`);
  const bytes = readFileSync(plan.archive);
  assert.ok(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const packageURL = `https://raw.githubusercontent.com/codyfactory/helm-charts/main/${plan.archive}`;
  const response = await request(packageURL, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Public chart download failed with HTTP ${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.equal(downloaded.length, bytes.length, 'Public chart size differs');
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), sha256, 'Public chart hash differs');
  return { schemaVersion: 1, kind: 'chart', repository: 'codyfactory/helm-charts', version: plan.version, sourceCommit: plan.sourceCommit,
    verifyRunId: env.VERIFY_RUN_ID, publishRunId: env.GITHUB_RUN_ID, publishRunAttempt: env.GITHUB_RUN_ATTEMPT,
    chart: { version: plan.version, publicationCommit: plan.publicationCommit, packageURL, size: bytes.length, sha256 } };
}
export function publishReceipt(value, command = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000 })) {
  mkdirSync('artifacts', { recursive: true });
  const file = 'artifacts/publication.json';
  const tag = `cody-execution-${value.version}`;
  const existing = JSON.parse(command(['api', '--paginate', '--slurp', 'repos/codyfactory/helm-charts/releases?per_page=100'])).flat().find(item => item.tag_name === tag);
  if (existing) {
    const asset = existing.assets.find(item => item.name === 'publication.json');
    assert.ok(asset || existing.draft, 'Published chart release must have metadata');
    if (asset) {
      const previous = JSON.parse(command(['api', asset.url, '-H', 'Accept: application/octet-stream']));
      assert.deepEqual(previous.chart, value.chart, 'Existing chart publication bytes changed');
      assert.equal(previous.sourceCommit, value.sourceCommit, 'Chart source changed');
    }
  }
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  if (existing) command(['release', 'upload', tag, file, '--repo', value.repository, '--clobber']);
  else command(['release', 'create', tag, file, '--repo', value.repository, '--verify-tag', '--title', `Execution chart ${value.version}`,
    '--notes', `Published from ${value.sourceCommit}; hosted activation is managed by Cody.`, '--draft', '--latest=false']);
  if (!existing || existing.draft) command(['release', 'edit', tag, '--repo', value.repository, '--draft=false', '--latest=false']);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishReceipt(await receipt(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
}
