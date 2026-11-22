import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const sourcePaths = ['charts', 'examples', 'tests', 'scripts', 'mise.toml', '.github'];
const url = 'https://raw.githubusercontent.com/codyfactory/helm-charts/main';
const run = (program, args, cwd = process.cwd()) => execFileSync(program, args, { cwd, encoding: 'utf8' }).trim();
const git = args => run('git', args);

export function nextVersion(index, sourceVersion) {
  const versions = [...index.matchAll(/^    version: (\d+)\.(\d+)\.(\d+)$/gm)].map(match => match.slice(1).map(Number));
  assert.ok(versions.length, 'Published index must contain a stable version');
  versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const latest = versions.at(-1);
  if (sourceVersion) {
    assert.match(sourceVersion, /^\d+\.\d+\.\d+$/);
    const source = sourceVersion.split('.').map(Number);
    if ((source[0] - latest[0] || source[1] - latest[1] || source[2] - latest[2]) > 0) return sourceVersion;
  }
  return `${latest[0]}.${latest[1]}.${latest[2] + 1}`;
}

export function appendEntry(index, generated) {
  const entry = generated.split('  cody-execution:\n')[1]?.split('\ngenerated:')[0];
  assert.ok(entry && index.includes('  cody-execution:\n'), 'Expected the cody-execution chart index');
  return index.replace('  cody-execution:\n', `  cody-execution:\n${entry}\n`);
}

export function publish(verified) {
  assert.match(verified, /^[a-f0-9]{40}$/);
  git(['fetch', 'origin', 'main']);
  if (git(['log', '-1', '--format=%H', `--grep=^Chart-Source: ${verified}$`, 'origin/main'])) {
    console.log('Verified source is already published');
    return;
  }
  const parent = git(['rev-parse', `${verified}^`]);
  if (!git(['diff', '--name-only', parent, verified, '--', ...sourcePaths])) {
    console.log('No chart source changes');
    return;
  }
  if (git(['diff', '--name-only', verified, 'origin/main', '--', ...sourcePaths])) {
    console.log('Newer chart source is awaiting its own verification');
    return;
  }
  git(['checkout', '--detach', 'origin/main']);
  const index = readFileSync('index.yaml', 'utf8');
  const sourceVersion = /^version: (.+)$/m.exec(readFileSync('charts/cody-execution/Chart.yaml', 'utf8'))?.[1];
  const version = nextVersion(index, sourceVersion);
  const temporary = mkdtempSync(join(tmpdir(), 'chart-publish-'));
  try {
    run('helm', ['package', 'charts/cody-execution', '--version', version, '--destination', temporary]);
    run('helm', ['repo', 'index', temporary, '--url', url]);
    const name = `cody-execution-${version}.tgz`;
    cpSync(join(temporary, name), name);
    writeFileSync('index.yaml', appendEntry(index, readFileSync(join(temporary, 'index.yaml'), 'utf8')));
    git(['add', '--', name, 'index.yaml']);
    git(['-c', 'user.name=cody-chart-release[bot]', '-c', 'user.email=cody-chart-release[bot]@users.noreply.github.com',
      'commit', '-m', `chore: publish execution chart ${version}`, '-m', `Chart-Source: ${verified}`]);
    git(['tag', `cody-execution-${version}`]);
    git(['push', '--atomic', 'origin', 'HEAD:main', `refs/tags/cody-execution-${version}`]);
    console.log(`Published chart ${version} from ${verified}`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) publish(process.argv[2]);
