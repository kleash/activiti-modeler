import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

import { dropFiles, menu } from './app';

/** The N01 negative corpus (`corpus/N01-negative`): hand-written models and the oracle of the problems each one must produce. */
export const N01_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../corpus/N01-negative');

export interface N01Entry {
  expect: string[];
  context?: string[];
  afterFixes?: string[];
}

export const n01Oracle = (): Record<string, N01Entry> =>
  (JSON.parse(readFileSync(join(N01_DIR, 'expected-lint.json'), 'utf8')) as { files: Record<string, N01Entry> }).files;

export interface Row {
  rule: string;
  element: string;
  severity: string;
  path: string;
  source: string;
  key: string;
}

export const problemsPanel = (page: Page): Locator => page.getByTestId('problems-panel');
export const problemRows = (page: Page): Locator => problemsPanel(page).getByTestId('problem');

/** Opens the bottom panel (when it is closed) and its Problems tab. */
export async function openProblems(page: Page): Promise<void> {
  if (!(await page.getByTestId('problems-tab').isVisible())) await page.keyboard.press('Control+B');
  await page.getByTestId('problems-tab').click();
  await expect(problemsPanel(page)).toBeVisible();
}

export async function rows(page: Page): Promise<Row[]> {
  return problemRows(page).evaluateAll((items) =>
    items.map((li) => ({
      rule: li.getAttribute('data-rule') ?? '',
      element: li.getAttribute('data-element') ?? '',
      severity: li.getAttribute('data-severity') ?? '',
      path: li.getAttribute('data-path') ?? '',
      source: li.getAttribute('data-source') ?? '',
      key: li.getAttribute('data-key') ?? '',
    })),
  );
}

/** `rule@element` (or `rule` without an element) of the listed problems, sorted; `path` limits them to one file. */
export async function problemIds(page: Page, path?: string): Promise<string[]> {
  return (await rows(page))
    .filter((r) => path === undefined || r.path === path)
    .map((r) => (r.element ? `${r.rule}@${r.element}` : r.rule))
    .sort();
}

/** Drops the files of an N01 case the way a user drags them in: its context files, then the model with its sidecar. */
export async function dropCase(page: Page, file: string, entry: N01Entry): Promise<string> {
  const files: Array<{ name: string; content: string }> = [];
  for (const c of entry.context ?? []) files.push({ name: c.slice(c.lastIndexOf('/') + 1), content: readFileSync(join(N01_DIR, 'models/context', c), 'utf8') });
  const sidecar = file.replace(/\.bpmn20\.xml$/, '-extensions.json');
  if (sidecar !== file && existsSync(join(N01_DIR, 'models', sidecar))) files.push({ name: sidecar, content: readFileSync(join(N01_DIR, 'models', sidecar), 'utf8') });
  files.push({ name: file, content: readFileSync(join(N01_DIR, 'models', file), 'utf8') });
  await dropFiles(page, files);
  return `processes/${file}`;
}

/** The rows of a file that offer a quick fix. */
export const fixRows = (page: Page, path: string): Locator => problemRows(page).and(page.locator(`[data-path="${path}"]`)).filter({ has: page.getByTestId('problem-fix') });

/** File > Export project as zip (the real export pipeline: it saves the open edits and checks the serializer's guarantees first); returns the files. */
export async function exportZip(page: Page, testInfo: TestInfo): Promise<Record<string, string>> {
  const downloaded = page.waitForEvent('download');
  await menu(page, 'File', 'Export project as zip');
  const path = testInfo.outputPath('export.zip');
  await (await downloaded).saveAs(path);
  return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(readFileSync(path)))).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

/** Drops the files of an exported project (below `processes/`, `connectors/`) into the app, as a user re-imports them. */
export async function dropExported(page: Page, files: Record<string, string>): Promise<void> {
  await dropFiles(
    page,
    Object.entries(files)
      .filter(([name]) => /^(processes|connectors)\//.test(name))
      .map(([name, content]) => ({ name: name.slice(name.lastIndexOf('/') + 1), content })),
  );
}
