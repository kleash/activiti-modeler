import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, test, type TestInfo } from '@playwright/test';

import { type CorpusModeler, ModelerApi } from '../support/modelerApi';
import { test as uiTest } from '../support/test';
import { UiModeler } from '../support/uiModeler';

/**
 * Corpus builds. For every `corpus/<id>/build.ts` this
 *  1. opens the modeler (production bundle with `window.__modelerTestApi`),
 *  2. runs the build, which models the seed project of `corpus/<id>/seed` through the same accessors and commands the UI uses,
 *  3. exports it with the real export pipeline into `java/verification-harness/target/corpus/<id>` (override with CORPUS_OUT),
 *     where the verification harness picks it up together with the hand-written oracles of `corpus/<id>`, and
 *  4. compares the generated BPMN and extensions with the seed semantically and fails on any difference that the build
 *     does not declare as intentional.
 *
 * A build that exports `uiDriven = true` runs a second time through the real UI (`UiModeler`: menus, palette, context pad, replace
 * menu, properties panel, DRD and decision table cells), exports with File > Export project as zip into
 * `java/verification-harness/target/corpus-ui/<id>` (next to CORPUS_OUT) and is compared with the seed the same way.
 *
 * A build file default-exports `async (api: ModelerApi) => void` (`CorpusModeler` for a UI-driven one) and may export
 * `semanticDiff` (see `CorpusDiffConfig`).
 */

export interface CorpusDiffConfig {
  /** Local names of BPMN elements that exist only in the generated model (see `BpmnDiffOptions`). */
  ignoreElements?: string[];
  /** Differences (by pattern) the build knows about, with the reason; they are reported but do not fail the build. */
  allow?: Array<{ pattern: RegExp; reason: string }>;
}

interface CorpusBuildModule {
  default: (api: ModelerApi) => Promise<void>;
  semanticDiff?: CorpusDiffConfig;
  /** Export warnings the build knows about (the seed keeps the construct on purpose), with the reason; any other warning fails the build. */
  exportWarnings?: Array<{ pattern: RegExp; reason: string }>;
  /** The build also runs through the real UI; it calls only what `CorpusModeler` has. */
  uiDriven?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const corpusRoot = join(repoRoot, 'corpus');
const outRoot = process.env['CORPUS_OUT'] ? resolve(process.env['CORPUS_OUT']) : join(repoRoot, 'java', 'verification-harness', 'target', 'corpus');
const uiOutRoot = `${outRoot}-ui`;

const wanted = (process.env['CORPUS_PROJECTS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function projectIds(): Promise<string[]> {
  const entries = await readdir(corpusRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(corpusRoot, e.name, 'build.ts')))
    .map((e) => e.name)
    .filter((id) => wanted.length === 0 || wanted.some((w) => id.startsWith(w)))
    .sort();
}

async function readIfExists(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, 'utf8') : undefined;
}

/** The module of a build file, whether the loader hands over an ES module namespace or a CommonJS wrapper. */
async function loadBuild(file: string): Promise<CorpusBuildModule> {
  const loaded = (await import(pathToFileURL(file).href)) as CorpusBuildModule & { default: unknown };
  const candidate = (typeof loaded.default === 'function' ? loaded : (loaded.default as CorpusBuildModule)) as CorpusBuildModule;
  if (typeof candidate.default !== 'function') throw new Error(`${file} must default-export an async function (api: ModelerApi) => Promise<void>`);
  return candidate;
}

/** Runs the build through a driver, exports the project into `outDir` and compares it with the seed semantically. */
async function buildAndCompare(id: string, build: CorpusBuildModule, api: ModelerApi | UiModeler, outDir: string, testInfo: TestInfo): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  if (api instanceof UiModeler) await (build.default as unknown as (api: CorpusModeler) => Promise<void>)(api);
  else await build.default(api);
  const { paths, project } = await api.writeProject(outDir);
  console.log(`${id}: ${paths.length} files written to ${outDir}`);
  const knownWarnings = build.exportWarnings ?? [];
  for (const w of project.warnings.filter((x) => knownWarnings.some((k) => k.pattern.test(x)))) {
    console.log(`${id}: expected export warning: ${w} (${knownWarnings.find((k) => k.pattern.test(w))!.reason})`);
  }
  expect(project.warnings.filter((w) => !knownWarnings.some((k) => k.pattern.test(w))), `export warnings of ${id}`).toEqual([]);

  // --- semantic comparison with the hand-written seed
  const seedDir = join(corpusRoot, id, 'seed', 'processes');
  const seedFiles = (await readdir(seedDir)).filter((f) => f.endsWith('.bpmn20.xml')).sort();
  const generatedFiles = project.files.filter((f) => f.path.endsWith('.bpmn20.xml')).map((f) => f.path.replace(/^processes\//, '')).sort();
  const differences: string[] = [];
  for (const missing of seedFiles.filter((f) => !generatedFiles.includes(f))) differences.push(`${missing}: the seed process file is not generated`);
  for (const extra of generatedFiles.filter((f) => !seedFiles.includes(f))) differences.push(`${extra}: generated, but the seed has no such process file`);
  for (const file of seedFiles.filter((f) => generatedFiles.includes(f))) {
    const generatedXml = project.files.find((f) => f.path === `processes/${file}`)!.content;
    const base = file.replace(/\.bpmn20\.xml$/, '');
    const generatedExt = project.files.find((f) => f.path === `processes/${base}-extensions.json`)?.content;
    const seedXml = await readFile(join(seedDir, file), 'utf8');
    const seedExt = await readIfExists(join(seedDir, `${base}-extensions.json`));
    for (const d of await api.diffBpmn(seedXml, generatedXml, build.semanticDiff?.ignoreElements ? { ignoreElements: build.semanticDiff.ignoreElements } : undefined)) differences.push(`${file}: ${d}`);
    for (const d of await api.diffExtensions(seedExt, generatedExt)) differences.push(`${base}-extensions.json: ${d}`);
  }
  // the DMN files: the same semantic comparison (decision and rule ids are a contract, the diagram is not)
  const seedDmn = (await readdir(seedDir)).filter((f) => f.endsWith('.dmn')).sort();
  const generatedDmn = project.files.filter((f) => f.path.endsWith('.dmn')).map((f) => f.path.replace(/^processes\//, '')).sort();
  for (const missing of seedDmn.filter((f) => !generatedDmn.includes(f))) differences.push(`${missing}: the seed DMN file is not generated`);
  for (const extra of generatedDmn.filter((f) => !seedDmn.includes(f))) differences.push(`${extra}: generated, but the seed has no such DMN file`);
  for (const file of seedDmn.filter((f) => generatedDmn.includes(f))) {
    const generatedXml = project.files.find((f) => f.path === `processes/${file}`)!.content;
    const seedXml = await readFile(join(seedDir, file), 'utf8');
    for (const d of await api.diffDmn(seedXml, generatedXml)) differences.push(`${file}: ${d}`);
  }
  // nothing but the seed's files and the project descriptor is generated for the harness
  const unexpected = project.files.map((f) => f.path).filter((p) => p !== 'project.json' && !p.startsWith('processes/') && !p.startsWith('connectors/'));
  differences.push(...unexpected.map((p) => `${p}: unexpected generated file`));

  const allowed = build.semanticDiff?.allow ?? [];
  const reported = differences.filter((d) => !allowed.some((a) => a.pattern.test(d)));
  for (const d of differences.filter((x) => !reported.includes(x))) {
    const reason = allowed.find((a) => a.pattern.test(d))!.reason;
    testInfo.annotations.push({ type: 'intentional difference', description: `${d} (${reason})` });
    console.log(`${id}: intentional difference: ${d} (${reason})`);
  }
  expect(reported, `${id}: the generated project differs from the seed`).toEqual([]);
}

const ids = await projectIds();
const builds = new Map<string, CorpusBuildModule>();
for (const id of ids) builds.set(id, await loadBuild(join(corpusRoot, id, 'build.ts')));
const uiIds = ids.filter((id) => builds.get(id)!.uiDriven === true);

// first, so that the long UI builds start before the short ones
uiTest.describe('corpus builds through the UI', () => {
  // the connection probe of the run feature asks for a modeler server that the builds do not start
  uiTest.use({ viewport: { width: 1920, height: 1080 }, actionTimeout: 20_000, allowedErrors: [/Failed to load resource/] });

  for (const id of uiIds) {
    uiTest(`${id} [ui]: models the seed with clicks and typing, exports it and equals the seed semantically`, async ({ page }, testInfo) => {
      // the longest build (C08) takes about three and a half minutes on a laptop
      uiTest.setTimeout(15 * 60_000);
      await buildAndCompare(id, builds.get(id)!, await UiModeler.open(page), join(uiOutRoot, id), testInfo);
    });
  }
});

test.describe('corpus builds', () => {
  test('the corpus has builds to run', () => {
    expect(ids, `no corpus/<id>/build.ts matches ${JSON.stringify(wanted)} in ${corpusRoot}`).not.toEqual([]);
  });

  for (const id of ids) {
    test(`${id}: models the seed, exports it and equals the seed semantically`, async ({ page }, testInfo) => {
      await buildAndCompare(id, builds.get(id)!, await ModelerApi.open(page), join(outRoot, id), testInfo);
    });
  }
});
