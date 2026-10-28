# payout-audit

> **Try it in your browser:** [https://cryptoplay.guide/tools/payout-rtp-audit/](https://cryptoplay.guide/tools/payout-rtp-audit/) — free, runs client-side, no sign-up. 18+, for education only.

Small, dependency-free JavaScript package for auditing a JSON probability/payout table. Calculates return to player (RTP), house edge, expected net result, variance and standard deviation. Node.js 18+ ESM; the pure library also runs in modern browsers with BigInt support.

For background on the calculation, see this explanation of [dice odds and house edge](https://cryptoplay.guide/guides/dice-game-odds-house-edge/).

## Install from git

Install directly from the repository, replacing HOST and OWNER with its actual location:

```sh
npm install 'git+ssh://git@HOST/OWNER/payout-audit.git'
```

There are no dependencies or build steps. From an existing checkout, run the CLI with `node bin/payout-audit.js`. This package does not require a registry release.

## Table format

All amounts are multiples of a **one-unit stake**. Set `payoutIncludesStake` explicitly:

- `true`: `payout` is the total amount returned, including any returned stake. A complete loss is `0`, a push is `1`, and a win returning twice the stake is `2`.
- `false`: `payout` is the **signed net result for every outcome**. A complete loss is `-1`, a push is `0`, and a win returning twice the stake is `1`. Do not enter `0` for a losing bet in this mode. The library adds one to each row to obtain the total return.

```json
{
  "payoutIncludesStake": true,
  "outcomes": [
    { "label": "win", "probability": "1/6", "payout": "297/50" },
    { "label": "lose", "probability": "5/6", "payout": "0" }
  ]
}
```

Outcomes must be mutually exclusive and exhaustive. Labels and other metadata are optional and ignored. Probabilities must be between zero and one and sum to **exactly one**; there is no tolerance, rounding repair or automatic normalization. Zero-probability rows are allowed and still validated. Total returns must be nonnegative (net results at least `-1`). Missing fields, invalid numbers and empty tables throw errors.

Use strings for fractions (`"1/3"`), large integers, decimals (`"0.125"`) or scientific notation (`"1e-3"`). Strings are parsed with BigInt arithmetic and reduced to exact rational numbers. Fraction denominators must be nonzero integers; signs are normalized. Surrounding whitespace is accepted. Numeric inputs use their JavaScript decimal string representation: `0.1` is treated as `1/10`, but `1 / 3` has already been rounded before the call. Likewise, `0.1 + 0.2` is not exactly `"3/10"`. Unsafe integer numbers are rejected; pass them as strings. Numeric strings are limited to 10,000 characters and decimal exponents to -10,000 through 10,000.

## Library usage

```js
import { auditTable, validateTable, parseRational } from 'payout-audit';

const table = {
  payoutIncludesStake: true,
  outcomes: [
    { probability: '1/6', payout: '297/50' },
    { probability: '5/6', payout: '0' }
  ]
};

validateTable(table); // { outcomeCount: 2, probabilitySum: '1' }
const report = auditTable(table); // also validates
console.log(report.rtp);                   // 0.99 (ratio, not percent)
console.log(report.houseEdge);             // 0.01
console.log(report.exact.expectedNet);     // '-1/100'
console.log(report.exact.variance);        // '9801/2000'
console.log(report.standardDeviation);     // approximately 2.2137 stake units
console.log(parseRational('6/8'));          // { numerator: 3n, denominator: 4n }
```

In a browser, import the same functions from `./src/index.js` in a `<script type="module">`. No Node APIs, globals or I/O are used by the library. Functions do not mutate their inputs.

`auditTable` returns `outcomeCount`, `probabilitySum`, `rtp`, `houseEdge`, `expectedNet`, `variance`, `standardDeviation` and `exact`. All fields in `exact` are reduced fraction strings (integers omit `/1`), including `probabilitySum`. The report is JSON serializable. `parseRational` returns BigInts and must be converted to strings before JSON serialization.

The numeric moment fields are floating-point approximations for display; exact fields are authoritative. Square roots are generally irrational, so standard deviation has only an approximate numeric field. Numeric overflow yields `null`; underflow can yield zero. Standard deviation is scaled separately so it can remain representable even if numeric variance overflows or underflows.

## CLI usage

```sh
node bin/payout-audit.js examples/edge-d6.json
node bin/payout-audit.js --json examples/two-dice-net.json
cat examples/fair-d6.json | node bin/payout-audit.js --json -
```

After installation the same command is available as `payout-audit` (for example, `npx --no-install payout-audit --help`). The default report shows RTP and house edge as percentages with exact ratios alongside them; `--json` prints the library report. Use `--` before filenames that start with a hyphen. Errors go to stderr with a nonzero exit status.

## Mathematics and dice examples

Let `pᵢ` be an outcome's probability and `gᵢ` its total return in stake units. For a single bet:

```text
RTP                = Σ pᵢ gᵢ
Expected net       = RTP − 1
House edge         = 1 − RTP
Variance           = Σ pᵢ (gᵢ − RTP)²
Standard deviation = √Variance
```

Variance is in squared stake units; standard deviation is in stake units. Subtracting the fixed stake leaves variance unchanged, so gross and net conventions give the same variance. To express results for a fixed stake `s`, multiply expected net and standard deviation by `s`, and variance by `s²`. RTP and house edge are ratios. A negative house edge means the supplied table favors the player mathematically. These calculations describe the supplied rules; they do not verify randomness or payout reliability or predict any session's result.

The included tables are mathematical examples under explicit fair-dice assumptions, not observations or claims about an operator:

| File | Derivation | Exact RTP | Exact house edge | Exact variance |
| --- | --- | --- | --- | --- |
| `examples/fair-d6.json` | A fair d6 has six equally likely faces; only 6 wins. Total return 6, so RTP = `(1/6) × 6`. | `1` | `0` | `5` |
| `examples/edge-d6.json` | The same event, with a hypothetical total return `297/50` (5.94). RTP = `(1/6) × (297/50)`. | `99/100` | `1/100` | `9801/2000` |
| `examples/two-dice-net.json` | Two independent fair d6 rolls have `6 × 6 = 36` equally likely ordered pairs. Only `(6,6)` wins. Net win 34 means total return 35; the other 35 pairs lose the stake. | `35/36` | `1/36` | `42875/1296` |

For a win probability `p` and total winning return `g` (zero otherwise), variance is `p(1 − p)g²`. Tests enumerate the die faces and ordered pairs to check these probabilities from first principles, then check the exact moments.

## Tests

```sh
npm test
```

Uses Node's built-in test runner; no dependencies. Tests cover exact fractions, decimal/scientific inputs, probability validation, payout conventions, large numbers, dice enumeration and the CLI.

## Responsible gambling

18+ only. No strategy beats the house edge. If gambling is causing harm, stop and seek local help resources: a local gambling support service, public health service or qualified counselor can help.

## License

MIT. Copyright (c) 2026 CryptoPlay Guide.
