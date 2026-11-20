import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const [version, execution, native, output] = process.argv.slice(2);
assert.match(version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-dev\.\d+\.\d+)?$/);
for (const image of [execution, native]) assert.match(image ?? '', /^ghcr\.io\/codyfactory\/[a-z0-9-]+@sha256:[0-9a-f]{64}$/);
assert.ok(output, 'Output directory is required');
const temporary = mkdtempSync(join(tmpdir(), 'cody-chart-'));
try {
  const chart = join(temporary, 'cody-execution');
  cpSync('charts/cody-execution', chart, { recursive: true });
  let values = readFileSync(join(chart, 'values.yaml'), 'utf8');
  for (const [pattern, replacement] of [
    [/^image:.*$/gm, `image: ${JSON.stringify(execution)}`],
    [/^(onboarding:\n(?:  .*\n)*?  image:).*$/gm, `$1 ${JSON.stringify(native)}`],
  ]) {
    assert.equal([...values.matchAll(pattern)].length, 1, 'Expected exactly one chart image default');
    values = values.replace(pattern, replacement);
  }
  writeFileSync(join(chart, 'values.yaml'), values);
  mkdirSync(resolve(output), { recursive: true });
  execFileSync('helm', ['lint', '--strict', chart, '--values', 'examples/lint-values.yaml'], { stdio: 'inherit' });
  execFileSync('helm', ['package', chart, '--version', version, '--app-version', version, '--destination', resolve(output)], { stdio: 'inherit' });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
