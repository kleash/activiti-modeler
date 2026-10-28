#!/usr/bin/env node
// Launcher: the CLI is bundled by `npm run build:cli -w @activiti-modeler/bpmnlint-plugin-activiti`.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/activiti-lint.mjs');
if (!existsSync(bundle)) {
  console.error('activiti-lint is not built yet: run `npm run build:cli -w @activiti-modeler/bpmnlint-plugin-activiti`');
  process.exit(2);
}
const { run } = await import(bundle);
// `exitCode`, not `exit()`: a pipe gets all the output
process.exitCode = await run(process.argv.slice(2));
