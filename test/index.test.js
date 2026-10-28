import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRational, validateTable, auditTable } from '../src/index.js';

const table = (outcomes, payoutIncludesStake = true) => ({ payoutIncludesStake, outcomes });
const row = (probability, payout) => ({ probability, payout });
const close = (actual, expected) => assert.ok(
  Math.abs(actual - expected) <= 1e-14 * Math.max(1, Math.abs(expected)),
  `${actual} should be approximately ${expected}`
);

test('parseRational reduces fractions, normalizes signs and parses decimals exactly', () => {
  for (const [input, numerator, denominator] of [
    ['6/8', 3n, 4n], ['-6/8', -3n, 4n], ['6/-8', -3n, 4n],
    ['-6/-8', 3n, 4n], ['+6/+8', 3n, 4n], ['0/-5', 0n, 1n],
    ['  1/3  ', 1n, 3n], ['0006/0008', 3n, 4n],
    [0.1, 1n, 10n], ['-.125', -1n, 8n], ['+1.25', 5n, 4n],
    ['1.', 1n, 1n], ['12.50e-2', 1n, 8n], ['1E+3', 1000n, 1n],
    ['1e-7', 1n, 10000000n], [1e-7, 1n, 10000000n], [-0, 0n, 1n],
    ['9007199254740993', 9007199254740993n, 1n]
  ]) assert.deepEqual(parseRational(input), { numerator, denominator });
});

test('rejects malformed rationals, nonfinite numbers and unsafe integer numbers', () => {
  for (const input of [undefined, null, true, {}, [], 1n, '', ' ', '1/0', '0/0',
    '1/2/3', '1.5/2', '1 / 2', '0x10', '1_000', 'Infinity', 'NaN',
    '.', '--1', '1e', '1e10001', '1e-10001', '1e999999999999999999',
    Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1'.repeat(10001)]) {
    assert.throws(() => parseRational(input), undefined, `should reject ${String(input)}`);
  }
  assert.equal(parseRational('1e10000').numerator, 10n ** 10000n);
  assert.equal(parseRational('1e-10000').denominator, 10n ** 10000n);
});

test('validates fractions whose floating-point sums would not be exactly one', () => {
  const thirds = table([row('1/3', 0), row('1/3', 1), row('1/3', 2)]);
  assert.deepEqual(validateTable(thirds), { outcomeCount: 3, probabilitySum: '1' });
  const report = auditTable(thirds);
  assert.deepEqual(report.exact, {
    probabilitySum: '1', rtp: '1', houseEdge: '0', expectedNet: '0', variance: '2/3'
  });
  close(report.standardDeviation, Math.sqrt(2 / 3));
  assert.equal(validateTable(table(Array.from({ length: 10 }, () => row('1/10', 1)))).probabilitySum, '1');
});

test('uses exact probability validation even when an incorrect sum rounds to one', () => {
  const denominator = '10000000000000000000000000000000000000000';
  const almostOne = '9999999999999999999999999999999999999999';
  assert.equal(Number(almostOne) / Number(denominator), 1);
  for (const check of [validateTable, auditTable]) {
    assert.throws(() => check(table([row(`${almostOne}/${denominator}`, 1)])), /sum to exactly 1/);
    assert.throws(() => check(table([row('1', 1), row(`1/${denominator}`, 1)])), /sum to exactly 1/);
    const valid = check(table([row(`${almostOne}/${denominator}`, 1), row(`1/${denominator}`, 1)]));
    assert.equal(valid.exact?.probabilitySum ?? valid.probabilitySum, '1');
  }
});

test('decimal and scientific input is exact, with no tolerance for already rounded arithmetic', () => {
  const report = auditTable(table([row(0.1, '1.25e1'), row('2e-1', 0), row('.7', 0)]));
  assert.equal(report.exact.rtp, '5/4');
  assert.equal(report.exact.houseEdge, '-1/4');
  assert.equal(report.exact.variance, '225/16');
  assert.throws(() => validateTable(table([row(0.1 + 0.2, 1), row(0.7, 1)])), /sum to exactly 1/);
  assert.throws(() => validateTable(table([row(1 / 3, 1), row(2 / 3, 1)])), /sum to exactly 1/);
});

test('requires an explicit boolean convention and complete, valid outcome rows', () => {
  const sparse = new Array(1);
  const invalid = [
    undefined, null, [], true, {}, { outcomes: [row(1, 1)] },
    { payoutIncludesStake: 'true', outcomes: [row(1, 1)] },
    { payoutIncludesStake: 1, outcomes: [row(1, 1)] },
    { payoutIncludesStake: true }, table([]), table({}), table(sparse),
    table([null]), table([[]]), table([1]), table([{}]),
    table([{ probability: 1 }]), table([{ payout: 1 }]),
    table([row(-0.1, 1), row(1.1, 1)]), table([row('2/1', 1)]),
    table([row('1/2', 1)]), table([row('3/4', 1), row('3/4', 1)]),
    table([row(1, -1)]), table([row(1, '-1.00001')], false),
    table([row(1, Infinity)]), table([row(1, 0), row(0, 'bad')]),
    table([row(1, 0), row(0, -1)])
  ];
  for (const input of invalid) {
    assert.throws(() => validateTable(input));
    assert.throws(() => auditTable(input));
  }
});

test('gross and signed net tables produce identical reports', () => {
  const gross = table([row('1/4', '3'), row('1/4', '1'), row('1/2', '0')]);
  const net = table([row('1/4', '2'), row('1/4', '0'), row('1/2', '-1')], false);
  assert.deepEqual(auditTable(gross), auditTable(net));
  assert.equal(auditTable(gross).exact.variance, '3/2');
  // A zero net result is a push, including in a row labelled "lose".
  assert.equal(auditTable(table([{ label: 'lose', ...row(1, 0) }], false)).exact.rtp, '1');
});

test('deterministic losses, pushes and wins have zero variance', () => {
  for (const [payout, rtp, edge, expectedNet] of [
    [0, '0', '1', '-1'], [1, '1', '0', '0'], [2, '2', '-1', '1']
  ]) {
    const report = auditTable(table([row(1, payout)]));
    assert.deepEqual(report.exact, { probabilitySum: '1', rtp, houseEdge: edge, expectedNet, variance: '0' });
    assert.equal(report.standardDeviation, 0);
  }
});

test('zero-probability rows do not contribute moments and inputs are not mutated', () => {
  const input = Object.freeze({
    payoutIncludesStake: true,
    description: 'Metadata is ignored',
    outcomes: Object.freeze([
      Object.freeze(row('1/2', 0)), Object.freeze(row('1/2', 2)),
      Object.freeze(row(0, '1e1000'))
    ])
  });
  const before = JSON.stringify(input);
  const first = auditTable(input);
  assert.equal(first.exact.variance, '1');
  assert.equal(first.standardDeviation, 1);
  first.exact.rtp = 'changed';
  assert.equal(auditTable(input).exact.rtp, '1');
  validateTable(input);
  assert.equal(JSON.stringify(input), before);
});

test('large rationals stay exact and conversion avoids Infinity divided by Infinity', () => {
  const denominator = 10n ** 400n;
  const payout = `${denominator - 1n}/${denominator}`;
  const report = auditTable(table([row(1, payout)]));
  assert.equal(report.exact.rtp, payout);
  assert.equal(report.exact.houseEdge, `1/${denominator}`);
  assert.equal(report.rtp, 1);
  assert.equal(report.houseEdge, 0); // Below the range of a Number.
  assert.equal(report.standardDeviation, 0);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('centered exact variance avoids cancellation for huge nearly equal returns', () => {
  const base = 10n ** 100n;
  const report = auditTable(table([row('1/2', String(base)), row('1/2', String(base + 2n))]));
  assert.equal(report.exact.rtp, String(base + 1n));
  assert.equal(report.exact.variance, '1');
  assert.equal(report.variance, 1);
  assert.equal(report.standardDeviation, 1);
});

test('standard deviation remains representable when numeric variance overflows or underflows', () => {
  for (const [payout, variance, sd] of [['2e200', null, 1e200], ['2e-200', 0, 1e-200]]) {
    const report = auditTable(table([row('1/2', 0), row('1/2', payout)]));
    assert.equal(report.variance, variance);
    assert.ok(Math.abs(report.standardDeviation / sd - 1) < 1e-14);
  }
  const huge = auditTable(table([row('1/2', 0), row('1/2', '2e1000')]));
  assert.equal(huge.rtp, null);
  assert.equal(huge.standardDeviation, null);
  assert.equal(JSON.parse(JSON.stringify(huge)).rtp, null);
});

test('shifting all gross returns preserves variance and changes the mean by that shift', () => {
  const original = auditTable(table([row('1/5', 0), row('3/10', 2), row('1/2', 4)]));
  const shifted = auditTable(table([row('1/5', '1/3'), row('3/10', '7/3'), row('1/2', '13/3')]));
  assert.equal(original.exact.variance, '61/25');
  assert.equal(shifted.exact.variance, original.exact.variance);
  close(shifted.rtp - original.rtp, 1 / 3);
});

test('dice example probabilities follow from enumerating equally likely rolls', async () => {
  const faces = Array.from({ length: 6 }, (_, i) => i + 1);
  const pairs = faces.flatMap(a => faces.map(b => [a, b]));
  const cases = [
    ['fair-d6.json', faces, face => face === 6, '1', '0', '5'],
    ['edge-d6.json', faces, face => face === 6, '99/100', '1/100', '9801/2000'],
    ['two-dice-net.json', pairs, ([a, b]) => a === 6 && b === 6, '35/36', '1/36', '42875/1296']
  ];
  for (const [file, rolls, wins, rtp, houseEdge, variance] of cases) {
    const input = JSON.parse(await readFile(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
    const winCount = rolls.filter(wins).length;
    assert.deepEqual(parseRational(input.outcomes[0].probability), parseRational(`${winCount}/${rolls.length}`));
    assert.deepEqual(parseRational(input.outcomes[1].probability), parseRational(`${rolls.length - winCount}/${rolls.length}`));
    const report = auditTable(input);
    assert.equal(report.exact.rtp, rtp);
    assert.equal(report.exact.houseEdge, houseEdge);
    assert.equal(report.exact.variance, variance);
    const v = parseRational(variance);
    close(report.standardDeviation, Math.sqrt(Number(v.numerator) / Number(v.denominator)));
  }
});
