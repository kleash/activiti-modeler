/** Loads the N01 negative corpus (`corpus/N01-negative`) for the tests: the oracle and the project of one case. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProjectFile } from '@activiti-modeler/activiti-project';

import type { Problem } from './types';

export const N01_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/N01-negative');
export const N01_MODELS = join(N01_ROOT, 'models');

export interface N01Oracle {
  files: Record<string, { expect: string[]; context?: string[]; afterFixes?: string[] }>;
}

export const n01Oracle = (): N01Oracle => JSON.parse(readFileSync(join(N01_ROOT, 'expected-lint.json'), 'utf8')) as N01Oracle;

/** The project of one case: `processes/<file>` (+ sidecar) and the context files below `models/context/`. */
export function caseProject(file: string, context: string[] = []): ProjectFile[] {
  const files: ProjectFile[] = [{ path: `processes/${file}`, content: readFileSync(join(N01_MODELS, file), 'utf8') }];
  const sidecar = file.replace(/\.bpmn20\.xml$/, '-extensions.json');
  if (sidecar !== file && existsSync(join(N01_MODELS, sidecar))) files.push({ path: `processes/${sidecar}`, content: readFileSync(join(N01_MODELS, sidecar), 'utf8') });
  for (const c of context) files.push({ path: c, content: readFileSync(join(N01_MODELS, 'context', c), 'utf8') });
  return files;
}

/** `rule@element` (or `rule`), sorted. */
export const problemIds = (problems: readonly Problem[]): string[] => problems.map((p) => `${p.rule}${p.elementId ? `@${p.elementId}` : ''}`).sort();
