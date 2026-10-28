#!/usr/bin/env node
// Exports the hand-written bad/good fixtures of the lint rules that mirror an Activiti ProcessValidator problem key, as a JSON snapshot
// for the Java verification harness (ValidatorMirrorTest), which runs them through the real engine.
//
//   node scripts/export-lint-fixtures.mjs            # rewrites java/verification-harness/src/test/resources/validator-mirror/fixtures.json
//
// The fixtures stay where they are (modeler/packages/bpmnlint-plugin-activiti/src/rules/validator-*.ts); this script only reads them
// and records a hash of those files, so that the test notices when the snapshot is out of date.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, 'modeler/packages/bpmnlint-plugin-activiti');
const out = resolve(root, 'java/verification-harness/src/test/resources/validator-mirror/fixtures.json');
const { createServer } = createRequire(resolve(root, 'modeler/package.json'))('vite');

const server = await createServer({
  root: plugin,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  ssr: { noExternal: [/^@activiti-modeler\//] },
});
try {
  const { RULES } = await server.ssrLoadModule('/src/catalog.ts');
  const { fixtureXml } = await server.ssrLoadModule('/src/testing/index.ts');
  const rulesDir = resolve(plugin, 'src/rules');
  const sources = readdirSync(rulesDir).filter((n) => /^validator-.*\.ts$/.test(n)).sort();
  const hash = createHash('sha256');
  for (const name of sources) hash.update(name).update(readFileSync(resolve(rulesDir, name)));
  const rules = RULES.filter((r) => r.key && r.tag === 'V' && r.target !== 'file').map((r) => ({
    id: r.id,
    key: r.key,
    severity: r.severity,
    bad: r.bad.map((f) => ({ xml: fixtureXml(f), ids: f.ids ?? [], note: f.note ?? null, asyncExecutorActive: f.context?.asyncExecutorActive ?? null })),
    good: r.good.map((f) => ({ xml: fixtureXml(f), note: f.note ?? null, asyncExecutorActive: f.context?.asyncExecutorActive ?? null })),
  }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ sources: sources.map((n) => `modeler/packages/bpmnlint-plugin-activiti/src/rules/${n}`), sourcesSha256: hash.digest('hex'), rules }, null, 1) + '\n');
  console.log(`wrote ${rules.length} rules to ${out}`);
} finally {
  await server.close();
}
