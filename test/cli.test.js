import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../bin/cli.js';

const example = fileURLToPath(new URL('../examples/edge-d6.json', import.meta.url));
const valid = JSON.stringify({ payoutIncludesStake: false, outcomes: [{ probability: 1, payout: -1 }] });
async function run(args, { input = '', ...adapters } = {}) {
  const output = [];
  const errors = [];
  const status = await runCli(args, {
    readInput: async () => input,
    writeOut: text => output.push(text),
    writeError: text => errors.push(text),
    ...adapters
  });
  return { status, stdout: output.join('\n'), stderr: errors.join('\n') };
}

test('CLI renders a human report and JSON output from an example file', async () => {
  const human = await run([example]);
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stderr, '');
  assert.match(human.stdout, /RTP: 99% \(exact ratio: 99\/100\)/);
  assert.match(human.stdout, /House edge: 1% \(exact ratio: 1\/100\)/);
  assert.match(human.stdout, /exact: 9801\/2000/);
  assert.match(human.stdout, /Standard deviation:/);
  for (const args of [['--json', example], [example, '--json']]) {
    const json = await run(args);
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.exact.rtp, '99/100');
    assert.equal(report.exact.variance, '9801/2000');
  }
});

test('CLI accepts standard input and signed net payouts', async () => {
  const result = await run(['--json', '-'], { input: valid });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).exact.expectedNet, '-1');
});

test('CLI help is successful and describes convention and stdin', async () => {
  for (const flag of ['--help', '-h']) {
    const result = await run([flag]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /standard input/);
    assert.match(result.stdout, /signed net/);
  }
});

test('CLI reports invalid arguments, JSON, files and table validation on stderr', async () => {
  for (const [args, options, message] of [
    [[], {}, /exactly one/],
    [[example, example], {}, /exactly one/],
    [['--unknown'], {}, /Unknown option/],
    [[`${example}.does-not-exist`], {}, /ENOENT/],
    [['-'], { input: '{' }, /payout-audit:/],
    [['-'], { input: '' }, /payout-audit:/],
    [['-'], { input: '{}' }, /payoutIncludesStake/],
    [['-'], { input: JSON.stringify({ payoutIncludesStake: true, outcomes: [{ probability: '1/3', payout: 1 }] }) }, /sum to exactly 1/]
  ]) {
    const result = await run(args, options);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

test('CLI -- permits filenames beginning with a hyphen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'payout-audit-'));
  try {
    writeFileSync(join(directory, '-table.json'), valid);
    const result = await run(['--json', '--', '-table.json'], {
      readText: file => {
        assert.equal(file, '-table.json');
        return readFile(join(directory, file), 'utf8');
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).exact.houseEdge, '1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI labels percentage overflow without printing Infinity', async () => {
  const result = await run(['-'], {
    input: JSON.stringify({ payoutIncludesStake: true, outcomes: [{ probability: 1, payout: '1e307' }] })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RTP: outside numeric range/);
  assert.doesNotMatch(result.stdout, /Infinity|NaN/);
});
