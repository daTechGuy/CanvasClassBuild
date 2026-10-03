/**
 * CLI: validate a Canvas-bound Common Cartridge offline.
 *
 *   npm run validate:imscc -- path/to/course.imscc
 *
 * Exit code 1 if any hard problem is found. Structural check only — it cannot
 * prove Canvas will accept the package; a real import (tools/canvas-test/) is
 * the source of truth.
 */
// Node has no DOMParser, and the validator needs a strict-enough one: happy-dom's
// flags unclosed/mismatched XML (linkedom silently accepts it and lacks the "*"
// selector). Must be set before the validator runs.
import { Window } from 'happy-dom';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser = new Window().DOMParser;

import { readFileSync } from 'node:fs';
import { validateImscc } from '../src/services/export/validateImscc';

const path = process.argv[2];
if (!path) {
  console.error('usage: npm run validate:imscc -- <file.imscc>');
  process.exit(2);
}

const report = await validateImscc(new Uint8Array(readFileSync(path)));
console.log(`== ${path}`);
for (const i of report.info) console.log(`  info    ${i}`);
for (const w of report.warnings) console.log(`  WARN    ${w}`);
for (const p of report.problems) console.log(`  PROBLEM ${p}`);
console.log(`RESULT: ${report.ok ? 'PASS' : 'FAIL'} (${report.problems.length} problems, ${report.warnings.length} warnings)`);
process.exit(report.ok ? 0 : 1);
