#!/usr/bin/env node
// Lints the seed of every corpus project with the CLI and fails when an error appears that is not an intentional trap.
//   node scripts/lint-corpus.mjs [corpus-folder]
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(process.argv[2] ?? resolve(here, '../../../../corpus'));

// Errors the seeds contain on purpose (project -> rule@element):
const INTENDED = new Map([
  // the harness connector bean `bpmnerror.EXECUTE` throws a BPMN error; the seed has no connector catalog
  ['C08-errors-compensation', ['activiti/connector-bean-unknown@callBroken']],
  // the KIE-only decision (BKM, context, invocation) is the point of the project; the default evaluator cannot run it
  ['C17-dmn-drd-kie', ['activiti/dmn-unsupported-on-operaton@discountRate', 'activiti/dmn-unsupported-on-operaton@finalPrice', 'activiti/dmn-unsupported-on-operaton@finalPrice']],
]);

execFileSync(process.execPath, [resolve(here, 'build-cli.mjs')], { stdio: 'ignore' });
let output;
try {
  output = execFileSync(process.execPath, [resolve(here, '../bin/activiti-lint.mjs'), corpus, '--seeds', '--json'], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
} catch (e) {
  output = e.stdout; // the exit status is 1 when a project has an error: that is judged here
}
const report = JSON.parse(output);
const unexpected = [];
const seen = new Map();
for (const { project, problems } of report) {
  const id = project.split(/[\\/]/).slice(-2)[0];
  for (const p of problems.filter((x) => x.severity === 'error')) {
    const found = `${p.rule}@${p.elementId ?? ''}`;
    const expected = [...(INTENDED.get(id) ?? [])];
    const seenHere = seen.get(id) ?? [];
    seen.set(id, [...seenHere, found]);
    const allowed = expected.filter((e) => e === found).length;
    if (seenHere.filter((s) => s === found).length >= allowed) unexpected.push(`${id}: ${found}  ${p.message}`);
  }
}
for (const [id, list] of INTENDED) {
  for (const e of list) if (!(seen.get(id) ?? []).includes(e)) unexpected.push(`${id}: the intended finding ${e} is gone (update scripts/lint-corpus.mjs)`);
}
const warnings = report.flatMap((r) => r.problems).filter((p) => p.severity === 'warning').length;
console.log(`${report.length} corpus project(s) linted, ${warnings} warning(s), ${[...INTENDED.values()].flat().length} intended error(s)`);
if (unexpected.length > 0) {
  console.error(`\n${unexpected.length} unexpected finding(s):\n${unexpected.map((u) => `  ${u}`).join('\n')}`);
  process.exitCode = 1;
}
