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

export function nextVersion(index, sourceVersion, chart = 'cody-execution') {
  index = index.split(`  ${chart}:\n`)[1]?.split(/\n(?=  [a-z]|generated:)/)[0] ?? '';
  if (!index) { assert.match(sourceVersion, /^\d+\.\d+\.\d+$/); return sourceVersion; }
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

export function appendEntry(index, generated, chart = 'cody-execution') {
  const heading = `  ${chart}:\n`;
  const entry = generated.split(heading)[1]?.split(/\n(?=  [a-z]|generated:)/)[0];
  assert.ok(entry, 'Generated chart entry is required');
  return index.includes(heading)
    ? index.replace(heading, `${heading}${entry}\n`)
    : index.replace('entries:\n', `entries:\n${heading}${entry}\n`);
}

export function publish(verified, chart = 'cody-execution') {
  assert.ok(['cody-execution', 'cody-control-plane'].includes(chart));
  const marker = chart === 'cody-execution' ? 'Chart-Source' : 'Control-Plane-Chart-Source';
  assert.match(verified, /^[a-f0-9]{40}$/);
  git(['fetch', 'origin', 'main']);
  const existing = git(['log', '-1', '--format=%H', `--grep=^${marker}: ${verified}$`, 'origin/main']);
  if (existing) {
    console.log('Verified source is already published');
    const archives = git(['diff-tree', '--no-commit-id', '--name-only', '-r', existing]).split('\n').filter(name => new RegExp(`^${chart}-\\d+\\.\\d+\\.\\d+\\.tgz$`).test(name));
    assert.equal(archives.length, 1, 'Published source must identify exactly one archive');
    git(['checkout', '--detach', 'origin/main']);
    return { sourceCommit: verified, publicationCommit: existing, version: archives[0].slice(`${chart}-`.length, -4), archive: archives[0] };
  }
  if (git(['diff', '--name-only', verified, 'origin/main', '--', ...sourcePaths])) {
    console.log('Newer chart source is awaiting its own verification');
    return;
  }
  const chartPaths = [`charts/${chart}`, 'scripts', 'mise.toml', '.github'];
  const published = git(['log', '-1', '--format=%H', 'origin/main', '--', `${chart}-*.tgz`]);
  if (published && !git(['diff', '--name-only', published, verified, '--', ...chartPaths])) {
    console.log('No chart source changes');
    return;
  }
  git(['checkout', '--detach', 'origin/main']);
  const index = readFileSync('index.yaml', 'utf8');
  const sourceVersion = /^version: (.+)$/m.exec(readFileSync(`charts/${chart}/Chart.yaml`, 'utf8'))?.[1];
  const version = nextVersion(index, sourceVersion, chart);
  const temporary = mkdtempSync(join(tmpdir(), 'chart-publish-'));
  try {
    run('helm', ['package', `charts/${chart}`, '--version', version, '--destination', temporary]);
    run('helm', ['repo', 'index', temporary, '--url', url]);
    const name = `${chart}-${version}.tgz`;
    cpSync(join(temporary, name), name);
    writeFileSync('index.yaml', appendEntry(index, readFileSync(join(temporary, 'index.yaml'), 'utf8'), chart));
    git(['add', '--', name, 'index.yaml']);
    git(['-c', 'user.name=cody-chart-release[bot]', '-c', 'user.email=cody-chart-release[bot]@users.noreply.github.com',
      'commit', '-m', `chore: publish ${chart} chart ${version}`, '-m', `${marker}: ${verified}`]);
    git(['tag', `${chart}-${version}`]);
    git(['push', '--atomic', 'origin', 'HEAD:main', `refs/tags/${chart}-${version}`]);
    console.log(`Published chart ${version} from ${verified}`);
    return { sourceCommit: verified, publicationCommit: git(['rev-parse', 'HEAD']), version, archive: name };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = publish(process.argv[2], process.argv[4]);
  if (result && process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result) + '\n');
}
