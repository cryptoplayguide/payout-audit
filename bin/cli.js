import { readFile } from 'node:fs/promises';
import { auditTable } from '../src/index.js';

const usage = `Usage: payout-audit [--json] <table.json|->

Audit a JSON probability/payout table. Use - to read standard input.
  --json      Print a JSON report with exact fractions and numeric values
  -h, --help  Show this help

Payout convention is required in the file: payoutIncludesStake: true or false.
With false, payouts are signed net results (-1 for a complete loss).`;

function parseArgs(args) {
  let json = false;
  let help = false;
  let positionalOnly = false;
  const files = [];
  for (const arg of args) {
    if (!positionalOnly && arg === '--') positionalOnly = true;
    else if (!positionalOnly && arg === '--json') json = true;
    else if (!positionalOnly && (arg === '--help' || arg === '-h')) help = true;
    else if (!positionalOnly && arg !== '-' && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (!help && files.length !== 1) throw new Error('Provide exactly one JSON file, or - for standard input');
  return { json, help, file: files[0] };
}

async function stdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

// Explicit I/O adapters let callers exercise the CLI without spawning a process.
export async function runCli(args, {
  readInput = stdin,
  readText = file => readFile(file, 'utf8'),
  writeOut = text => console.log(text),
  writeError = text => console.error(text)
} = {}) {
  try {
    const { json, help, file } = parseArgs(args);
    if (help) writeOut(usage);
    else {
      const input = file === '-' ? await readInput() : await readText(file);
      const report = auditTable(JSON.parse(input));
      if (json) writeOut(JSON.stringify(report, null, 2));
      else {
        const display = (value, scale = 1) => value === null || !Number.isFinite(value * scale)
          ? 'outside numeric range' : String(value * scale);
        writeOut([
          `Outcomes: ${report.outcomeCount}`,
          `Probability sum: ${report.exact.probabilitySum} (exact)`,
          `RTP: ${display(report.rtp, 100)}% (exact ratio: ${report.exact.rtp})`,
          `House edge: ${display(report.houseEdge, 100)}% (exact ratio: ${report.exact.houseEdge})`,
          `Expected net: ${display(report.expectedNet)} stakes (exact: ${report.exact.expectedNet})`,
          `Variance: ${display(report.variance)} stakes^2 (exact: ${report.exact.variance})`,
          `Standard deviation: ${display(report.standardDeviation)} stakes (approximate)`
        ].join('\n'));
      }
    }
    return 0;
  } catch (error) {
    writeError(`payout-audit: ${error.message}`);
    return 1;
  }
}
