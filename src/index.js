// One-unit stakes. No I/O or Node-specific APIs: this module also runs in browsers.
const ZERO = { numerator: 0n, denominator: 1n };
const ONE = { numerator: 1n, denominator: 1n };
const MAX_INPUT_LENGTH = 10000;
const MAX_EXPONENT = 10000;

function gcd(a, b) {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rational(numerator, denominator = 1n) {
  if (denominator === 0n) throw new RangeError('Denominator must not be zero');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/** Parse a number or a decimal/fraction string into a reduced BigInt rational. */
export function parseRational(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Number must be finite');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new RangeError('Unsafe integer: use a string to preserve precision');
    }
    value = String(value);
  }
  if (typeof value !== 'string') throw new TypeError('Expected a number or string');
  const input = value.trim();
  if (input.length > MAX_INPUT_LENGTH) throw new RangeError('Numeric input exceeds 10000 characters');
  const fraction = /^([+-]?\d+)\/([+-]?\d+)$/.exec(input);
  if (fraction) return rational(BigInt(fraction[1]), BigInt(fraction[2]));

  const decimal = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!decimal) throw new TypeError(`Invalid rational: ${input}`);
  const exponent = Number(decimal[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_EXPONENT) {
    throw new RangeError('Decimal exponent must be between -10000 and 10000');
  }
  const [whole, fractional = ''] = decimal[2].split('.');
  const digits = BigInt((whole || '0') + fractional);
  const signed = decimal[1] === '-' ? -digits : digits;
  const scale = fractional.length - exponent;
  return scale >= 0
    ? rational(signed, 10n ** BigInt(scale))
    : rational(signed * 10n ** BigInt(-scale));
}

function add(a, b) {
  const common = gcd(a.denominator, b.denominator);
  return rational(
    a.numerator * (b.denominator / common) + b.numerator * (a.denominator / common),
    (a.denominator / common) * b.denominator
  );
}

function negate(a) {
  return { numerator: -a.numerator, denominator: a.denominator };
}

function multiply(a, b) {
  const left = gcd(a.numerator, b.denominator);
  const right = gcd(b.numerator, a.denominator);
  return rational((a.numerator / left) * (b.numerator / right),
    (a.denominator / right) * (b.denominator / left));
}

function format(a) {
  return a.denominator === 1n ? String(a.numerator) : `${a.numerator}/${a.denominator}`;
}

// Scale before conversion so large numerator/denominator pairs do not yield Infinity/Infinity.
function scientific(a) {
  if (a.numerator === 0n) return { mantissa: 0, exponent: 0 };
  const negative = a.numerator < 0n;
  const n = String(negative ? -a.numerator : a.numerator);
  const d = String(a.denominator);
  const leadingN = n.slice(0, 17);
  const leadingD = d.slice(0, 17);
  let mantissa = Number(leadingN) / Number(leadingD);
  let exponent = n.length - leadingN.length - d.length + leadingD.length;
  while (mantissa >= 10) { mantissa /= 10; exponent++; }
  while (mantissa < 1) { mantissa *= 10; exponent--; }
  return { mantissa: negative ? -mantissa : mantissa, exponent };
}

function approximate(a, squareRoot = false) {
  let { mantissa, exponent } = scientific(a);
  if (squareRoot) {
    if (exponent % 2 !== 0) { mantissa *= 10; exponent--; }
    mantissa = Math.sqrt(mantissa);
    exponent /= 2;
  }
  const value = Number(`${mantissa}e${exponent}`);
  return Number.isFinite(value) ? value : null;
}

function normalizeTable(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    throw new TypeError('Table must be an object');
  }
  if (typeof table.payoutIncludesStake !== 'boolean') {
    throw new TypeError('payoutIncludesStake must explicitly be true or false');
  }
  if (!Array.isArray(table.outcomes) || table.outcomes.length === 0) {
    throw new TypeError('outcomes must be a nonempty array');
  }
  let probabilitySum = ZERO;
  const outcomes = Array.from(table.outcomes, (outcome, index) => {
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
      throw new TypeError(`outcomes[${index}] must be an object`);
    }
    const probability = parseRational(outcome.probability);
    if (probability.numerator < 0n || probability.numerator > probability.denominator) {
      throw new RangeError(`outcomes[${index}].probability must be between 0 and 1`);
    }
    const payout = parseRational(outcome.payout);
    const gross = table.payoutIncludesStake ? payout : add(payout, ONE);
    if (gross.numerator < 0n) {
      throw new RangeError(`outcomes[${index}].payout implies a negative total return`);
    }
    probabilitySum = add(probabilitySum, probability);
    return { probability, gross };
  });
  if (probabilitySum.numerator !== probabilitySum.denominator) {
    throw new RangeError(`Probabilities must sum to exactly 1; received ${format(probabilitySum)}`);
  }
  return outcomes;
}

/** Validate every row and require an exact sum of one; never renormalize inputs. */
export function validateTable(table) {
  const outcomes = normalizeTable(table);
  return { outcomeCount: outcomes.length, probabilitySum: '1' };
}

/** Return per-bet moments in stake units, with exact rational and approximate numeric fields. */
export function auditTable(table) {
  const outcomes = normalizeTable(table);
  let mean = ZERO;
  for (const { probability, gross } of outcomes) mean = add(mean, multiply(probability, gross));

  // Centered moments avoid cancellation and tiny negative floating-point variances.
  let variance = ZERO;
  for (const { probability, gross } of outcomes) {
    const deviation = add(gross, negate(mean));
    variance = add(variance, multiply(probability, multiply(deviation, deviation)));
  }
  const expectedNet = add(mean, negate(ONE));
  const houseEdge = negate(expectedNet);
  const moments = { rtp: mean, houseEdge, expectedNet, variance };
  return {
    outcomeCount: outcomes.length,
    probabilitySum: 1,
    ...Object.fromEntries(Object.entries(moments).map(([key, value]) => [key, approximate(value)])),
    standardDeviation: approximate(variance, true),
    exact: {
      probabilitySum: '1',
      ...Object.fromEntries(Object.entries(moments).map(([key, value]) => [key, format(value)]))
    }
  };
}
