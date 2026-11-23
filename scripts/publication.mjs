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
function findRelease(tag, command) {
  const query = 'query($tag:String!){repository(owner:"codyfactory",name:"helm-charts"){nameWithOwner release(tagName:$tag){databaseId tagName isDraft}}}';
  const result = JSON.parse(command(['api', 'graphql', '-f', `query=${query}`, '-f', `tag=${tag}`]));
  assert.equal(result.errors, undefined, 'Release lookup failed');
  const repository = result.data?.repository;
  assert.equal(repository?.nameWithOwner, 'codyfactory/helm-charts', 'Release repository unavailable');
  const selected = repository.release;
  if (selected === null) return;
  assert.ok(Number.isSafeInteger(selected?.databaseId) && selected.databaseId > 0, 'Invalid release identity');
  assert.equal(selected.tagName, tag);
  assert.equal(typeof selected.isDraft, 'boolean');
  const release = JSON.parse(command(['api', `repos/codyfactory/helm-charts/releases/${selected.databaseId}`]));
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, selected.isDraft);
  assert.ok(Array.isArray(release.assets));
  return release;
}
function successfulPublication(value, command) {
  for (const field of ['verifyRunId', 'publishRunId', 'publishRunAttempt']) assert.match(value[field], /^[1-9]\d*$/);
  const base = `repos/codyfactory/helm-charts/actions/runs/`;
  const source = JSON.parse(command(['api', base + value.verifyRunId]));
  const publisher = JSON.parse(command(['api', `${base}${value.publishRunId}/attempts/${value.publishRunAttempt}`]));
  for (const run of [source, publisher]) {
    assert.equal(run.status, 'completed', 'Previous publication is still active');
    assert.equal(run.head_branch, 'main');
    assert.equal(run.head_repository.full_name, value.repository);
  }
  assert.equal(source.conclusion, 'success', 'Previous source Verify did not succeed');
  assert.equal(source.event, 'push');
  assert.equal(source.path, '.github/workflows/verify.yml');
  assert.equal(source.head_sha, value.sourceCommit);
  assert.equal(publisher.event, 'workflow_run');
  assert.equal(publisher.path, '.github/workflows/publish.yml');
  assert.ok(['success', 'failure', 'cancelled', 'timed_out'].includes(publisher.conclusion), 'Invalid publisher conclusion');
  return publisher.conclusion === 'success';
}
const artifactIdentity = ({ verifyRunId, publishRunId, publishRunAttempt, ...artifact }) => artifact;
export function publishReceipt(value, command = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000 })) {
  mkdirSync('artifacts', { recursive: true });
  const file = 'artifacts/publication.json';
  const tag = `cody-execution-${value.version}`;
  const existing = findRelease(tag, command);
  let upload = true;
  if (existing) {
    const asset = existing.assets.find(item => item.name === 'publication.json');
    assert.ok(asset || existing.draft, 'Published chart release must have metadata');
    if (asset) {
      const previous = JSON.parse(command(['api', asset.url, '-H', 'Accept: application/octet-stream']));
      assert.deepEqual(artifactIdentity(previous), artifactIdentity(value), 'Existing chart publication identity changed');
      if (successfulPublication(previous, command)) { value = previous; upload = false; }
    }
  }
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  if (existing && upload) command(['release', 'upload', tag, file, '--repo', value.repository, '--clobber']);
  else if (!existing) command(['release', 'create', tag, file, '--repo', value.repository, '--verify-tag', '--title', `Execution chart ${value.version}`,
    '--notes', `Published from ${value.sourceCommit}; hosted activation is managed by Cody.`, '--draft', '--latest=false']);
  if (!existing || existing.draft) command(['release', 'edit', tag, '--repo', value.repository, '--draft=false', '--latest=false']);
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishReceipt(await receipt(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
}
