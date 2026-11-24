import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
const render = (...args) => execFileSync('helm', ['template', 'fixture', 'charts/cody-control-plane', '-f', 'examples/control-plane-values.yaml', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
test('Install and upgrade migrate with the serving image before updating workloads', () => {
  for (const upgrade of [[], ['--is-upgrade']]) {
    const result = render(...upgrade, '--set', 'image=example.test/plane:1.2.3');
    const job = result.split('---').find(doc => doc.includes('kind: Job'));
    assert.ok(job);
    assert.match(job, /helm.sh\/hook: pre-install,pre-upgrade/);
    assert.match(job, /helm.sh\/hook-delete-policy: before-hook-creation,hook-succeeded/);
    assert.doesNotMatch(job, /hook-failed|ttlSecondsAfterFinished/);
    assert.match(job, /image: "example.test\/plane:1.2.3"/);
    assert.match(job, /secretName: fixture-migration-db/);
    assert.match(job, /activeDeadlineSeconds: 300/);
    assert.match(job, /automountServiceAccountToken: false/);
    assert.match(job, /restartPolicy: OnFailure/);
  }
});
test('Migrations require a dedicated DSN and support explicit external orchestration', () => {
  assert.throws(() => render('--set', 'migrations.databaseSecret='), /migrations.databaseSecret is required/);
  assert.doesNotMatch(render('--set', 'migrations.enabled=false,migrations.databaseSecret='), /kind: Job/);
});
