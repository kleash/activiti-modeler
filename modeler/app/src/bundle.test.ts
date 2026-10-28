import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { activitiDmnModdleDescriptor, activitiModdleDescriptor } from '../../packages/activiti-moddle/src';

const APP_DIR = join(__dirname, '..');
const outputs: string[] = [];

/** The environment of a plain `npm run build`, whatever the test runner exported. */
function cleanEnv(testApi: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  for (const key of Object.keys(env)) if (key.startsWith('VITEST') || key === 'MODE' || key === 'DEV' || key === 'PROD') delete env[key];
  env['VITE_MODELER_TEST_API'] = testApi ? 'true' : '';
  return env;
}

/** Builds the app like `npm run build` does (without the type check) and returns the text of every script and stylesheet. */
function buildBundle(testApi: boolean): string {
  const outDir = mkdtempSync(join(tmpdir(), 'activiti-app-'));
  outputs.push(outDir);
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: APP_DIR,
    env: cleanEnv(testApi),
    stdio: 'pipe',
  });
  const assets = join(outDir, 'assets');
  return readdirSync(assets)
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
}

afterAll(() => {
  for (const dir of outputs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Camunda and Zeebe in the bundle (ADR 0001). The guarantee is about what the modeler is made of and what it writes: our moddle
 * descriptors, modules, providers and behaviours never contain Camunda or Zeebe, and neither does anything it exports. It is checked
 * in three places:
 *  1. here, the bundle has no module, provider or behaviour of either, and every `camunda:` / `zeebe:` name and namespace URI in it
 *     comes from the lint plugin or is inert upstream text (see below);
 *  2. here too, the moddle descriptors and, at source level, every file outside the lint plugin are free of both;
 *  3. in the specs of the exports (`e2e/n01.spec.ts` exports the fixed Camunda Modeler file and every other fixed model, the corpus
 *     builds export every seed) and the templates test of `activiti-project`.
 * The lint plugin must name the namespaces: its rule `no-camunda-extensions` (L1) finds the foreign attributes and elements of an
 * imported file, offers to translate them, and its fixtures and messages quote them. Two upstream libraries leave inert text behind
 * that is no module: the FEEL built-ins of `@bpmn-io/properties-panel` carry `{ camunda: ">=8.2" }` version metadata and links to the
 * Camunda docs, and the panel host of `bpmn-js-properties-panel` keeps a few helpers that name `zeebe:` types for the variable
 * extraction of its FEEL popup, and `bpmn-js-create-append-anything` ships (one file with everything) an element template helper that
 * reads `zeebe:modelerTemplate`; its element template module is not loaded, only the create and append menus are (feature U5).
 */
const MODULES = [
  /camunda[-_]?platform[-_]?properties[-_]?provider/i,
  /zeebe[-_]?properties[-_]?provider/i,
  /camunda-bpmn-(moddle|js-behaviors)/i,
  /zeebe-bpmn-moddle/i,
  /zeebe\.io\/(?!$)/i,
];
const NAMESPACES = [/camunda\.org\/schema/i, /camunda:[A-Za-z]/, /zeebe:[A-Za-z]/];
/** The `zeebe:` type names of the panel host's FEEL popup helpers. */
const INERT_ZEEBE_TYPES = new Set(['zeebe:AdHoc', 'zeebe:CalledDecision', 'zeebe:IoMapping', 'zeebe:LoopCharacteristics', 'zeebe:Script', 'zeebe:modelerTemplateIcon', 'zeebe:modelerTemplate']);

const REPO = join(APP_DIR, '..');
const PLUGIN = join(REPO, 'packages', 'bpmnlint-plugin-activiti');
/** The Camunda 7 importer (feature U17) names the namespaces it converts; like the lint plugin it is the sanctioned place for that. */
const IMPORTER = join(REPO, 'packages', 'activiti-project', 'src', 'import', 'camunda');

/** Non-test source files (ts, tsx, json, css) below the given folders. */
function sources(...folders: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|json|css)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(full);
    }
  };
  for (const folder of folders) walk(folder);
  return out;
}

const NAMES = /(?:camunda|zeebe):[A-Za-z]+/g;

function expectNoCamundaOrZeebe(bundle: string): void {
  for (const pattern of MODULES) expect(bundle, String(pattern)).not.toMatch(pattern);
  // every namespace name in the bundle is one the lint plugin quotes, or inert upstream text
  const quoted = new Set(sources(join(PLUGIN, 'src'), IMPORTER).flatMap((file) => readFileSync(file, 'utf8').match(NAMES) ?? []));
  const inBundle = new Set(bundle.match(NAMES) ?? []);
  const own = [...inBundle].filter((name) => !quoted.has(name) && !INERT_ZEEBE_TYPES.has(name));
  expect(own, 'camunda: / zeebe: names in the bundle that no lint rule quotes').toEqual([]);
}

describe('Camunda and Zeebe stay out of what the modeler is made of', () => {
  it('has no Camunda or Zeebe namespace in the moddle descriptors', () => {
    for (const descriptor of [activitiModdleDescriptor, activitiDmnModdleDescriptor]) {
      const text = JSON.stringify(descriptor);
      for (const pattern of [...MODULES, ...NAMESPACES, /camunda|zeebe/i]) expect(text, String(pattern)).not.toMatch(pattern);
    }
  });

  it('has no Camunda or Zeebe name in any source file outside the lint plugin and the Camunda importer', () => {
    const files = sources(join(APP_DIR, 'src'), ...readdirSync(join(REPO, 'packages'), { withFileTypes: true }).filter((p) => p.isDirectory() && p.name !== 'node_modules' && p.name !== 'bpmnlint-plugin-activiti').map((p) => p.name).map((name) => join(REPO, 'packages', name, 'src')).filter((dir) => existsSync(dir)));
    const hits = files.filter((file) => !file.startsWith(IMPORTER) && [...NAMESPACES, ...MODULES].some((pattern) => pattern.test(readFileSync(file, 'utf8'))));
    expect(hits).toEqual([]);
  });
});

describe('built bundle', () => {
  it('contains no Camunda or Zeebe namespace, module, provider or behaviour, and no test API in a normal build', { timeout: 180_000 }, () => {
    const bundle = buildBundle(false);
    expect(bundle.length).toBeGreaterThan(300_000);
    expect(bundle).toContain('http://activiti.org/bpmn');
    expectNoCamundaOrZeebe(bundle);
    expect(bundle).not.toContain('__modelerTestApi');
  });

  it('adds the test API (and still no Camunda or Zeebe) when VITE_MODELER_TEST_API=true', { timeout: 180_000 }, () => {
    const bundle = buildBundle(true);
    expect(bundle).toContain('__modelerTestApi');
    expectNoCamundaOrZeebe(bundle);
  });

  it('has the properties panel host and the Activiti provider, and none of the providers of bpmn-js-properties-panel', { timeout: 180_000 }, () => {
    const bundle = buildBundle(false);
    expect(bundle).toContain('activitiPropertiesProvider');
    expect(bundle).toContain('bio-properties-panel');
    expect(bundle).not.toMatch(/bpmnPropertiesProvider/);
  });
});
