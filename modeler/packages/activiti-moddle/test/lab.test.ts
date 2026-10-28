import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exportXml, importXml } from './support/moddle';
import { lostFacts } from './support/xml-facts';

// Models of the Activiti 9.0.0 lab runs (`tNN` in docs/research/activiti-9-bpmn-support.md, Appendix A); each one was deployed and run on the real engine.
const LAB_DIR = join(__dirname, 'fixtures/lab');
const labFiles = readdirSync(LAB_DIR).filter((f) => f.endsWith('.bpmn20.xml'));

describe('Activiti 9 lab models', () => {
  it('has the whole lab', () => {
    expect(labFiles.length).toBeGreaterThanOrEqual(90);
  });

  it.each(labFiles)('%s imports without warnings and round-trips without losing a fact', async (file) => {
    const xml = readFileSync(join(LAB_DIR, file), 'utf8');
    const imported = await importXml(xml);
    expect(imported.result.warnings.map((w) => w.message)).toEqual([]);
    const out = await exportXml(imported);
    expect(lostFacts(xml, out)).toEqual([]);
  });

  it('exports a second time to the same text (stable serialisation)', async () => {
    for (const file of labFiles) {
      const first = await exportXml(await importXml(readFileSync(join(LAB_DIR, file), 'utf8')));
      const second = await exportXml(await importXml(first));
      expect(second, file).toBe(first);
    }
  });
});

// Hand-written seed models of the verification corpus (corpus/<id>/seed/**), which the modeler's output must be able to replace.
const CORPUS_DIR = join(__dirname, '../../../../corpus');
function corpusXml(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return corpusXml(path);
    return path.endsWith('.bpmn20.xml') ? [path] : [];
  });
}
const seedFiles = corpusXml(CORPUS_DIR);

describe('corpus seed models', () => {
  it('exist', () => {
    expect(seedFiles.length).toBeGreaterThanOrEqual(1);
  });

  it.each(seedFiles.map((f) => [f.slice(CORPUS_DIR.length + 1), f] as const))('%s imports without warnings and round-trips without losing a fact', async (_name, file) => {
    const xml = readFileSync(file, 'utf8');
    const imported = await importXml(xml);
    expect(imported.result.warnings.map((w) => w.message)).toEqual([]);
    expect(lostFacts(xml, await exportXml(imported))).toEqual([]);
  });
});
