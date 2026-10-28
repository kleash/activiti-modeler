/** The `activiti-lint` command: exit codes, output formats and options, on small projects written to a temporary folder. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { RULES } from './catalog';
import { run } from './cli';
import { N01_MODELS, n01Oracle } from './n01-support';

const root = mkdtempSync(join(tmpdir(), 'activiti-lint-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NS = 'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn"';
const shape = (id: string, x: number, w = 100, h = 80): string => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="100" width="${w}" height="${h}"/></bpmndi:BPMNShape>`;

function process(body: string, ids: Array<[string, number]>, flows = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions ${NS} id="d" targetNamespace="urn:cli"><process id="p" isExecutable="true">${body}</process>
<bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="pl" bpmnElement="p">${ids.map(([id, x]) => shape(id, x, 100 * 1)).join('')}${flows}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>`;
}

/** start -> task -> end, with the task given by `task` (a service task with a class by default). */
const flowDoc = (task: string): string =>
  process(
    `<startEvent id="s" name="Start"/>${task}<endEvent id="e" name="End"/><sequenceFlow id="f1" sourceRef="s" targetRef="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="e"/>`,
    [['s', 100], ['t', 300], ['e', 500]],
    '<bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="200" y="140"/><di:waypoint x="300" y="140"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="f2_di" bpmnElement="f2"><di:waypoint x="400" y="140"/><di:waypoint x="500" y="140"/></bpmndi:BPMNEdge>',
  );

function project(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

async function cli(...argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await run(argv, (l) => lines.push(l));
  return { code, out: lines.join('\n') };
}

const GOOD = flowDoc('<serviceTask id="t" name="Work" activiti:class="com.example.Work"/>');
const BAD = flowDoc('<businessRuleTask id="t" name="Decide"/>');
const WARN = flowDoc('<serviceTask id="t" name="Work" activiti:class="com.example.Work" activiti:async="true"/>').replace('<startEvent id="s" name="Start"/>', '<startEvent id="s"/>');

describe('activiti-lint', () => {
  it('exits 0 for a project without errors', async () => {
    const dir = project('good', { 'processes/ok.bpmn20.xml': GOOD, 'processes/ok-extensions.json': '{"id":"ok-extensions","extensions":{"p":{"properties":{},"mappings":{},"constants":{}}}}' });
    const { code, out } = await cli(dir);
    expect(out).toContain('0 error(s)');
    expect(code).toBe(0);
  });

  it('exits 1 and names the rule, the file and the element of an error', async () => {
    const dir = project('bad', { 'processes/bad.bpmn20.xml': BAD });
    const { code, out } = await cli(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/processes\/bad\.bpmn20\.xml \[t\]\s+error\s+activiti\/no-business-rule-task/);
  });

  it('--json prints the problems as JSON without the internal ids', async () => {
    const dir = project('json', { 'processes/bad.bpmn20.xml': BAD });
    const { code, out } = await cli(dir, '--json');
    expect(code).toBe(1);
    const report = JSON.parse(out) as Array<{ project: string; problems: Array<{ rule: string; elementId?: string; severity: string; id?: string }> }>;
    expect(report).toHaveLength(1);
    expect(report[0]!.problems).toContainEqual(expect.objectContaining({ rule: 'activiti/no-business-rule-task', elementId: 't', severity: 'error' }));
    expect(report[0]!.problems.every((p) => p.id === undefined)).toBe(true);
  });

  it('--ignore drops a rule and so changes the exit status', async () => {
    const dir = project('ignore', { 'processes/bad.bpmn20.xml': BAD });
    const { code } = await cli(dir, '--ignore', 'activiti/no-business-rule-task');
    expect(code).toBe(0);
  });

  it('--max-warnings fails the run when there are more warnings', async () => {
    const dir = project('warn', { 'processes/w.bpmn20.xml': WARN });
    expect((await cli(dir)).code).toBe(0);
    expect((await cli(dir, '--max-warnings', '0')).code).toBe(1);
  });

  it('--quiet shows errors only', async () => {
    const dir = project('quiet', { 'processes/w.bpmn20.xml': WARN, 'processes/bad.bpmn20.xml': BAD });
    const { out } = await cli(dir, '--quiet');
    expect(out).toContain('activiti/no-business-rule-task');
    expect(out).not.toMatch(/\swarning\s/);
  });

  it('--seeds lints the seed folder of every project of a corpus folder', async () => {
    const corpus = join(root, 'corpus');
    project('corpus/A1/seed', { 'processes/a.bpmn20.xml': GOOD });
    project('corpus/B2/seed', { 'processes/b.bpmn20.xml': BAD });
    mkdirSync(join(corpus, 'C3'), { recursive: true });
    const { code, out } = await cli(corpus, '--seeds');
    expect(code).toBe(1);
    expect(out).toContain('A1/seed');
    expect(out).toContain('B2/seed');
    expect(out).not.toContain('C3');
    expect(out).toContain('2 project(s)');
  });

  describe('with a file instead of a project folder', () => {
    const SIDECAR = '{"id":"ok-extensions","extensions":{"p":{"properties":{},"mappings":{},"constants":{}}}}';

    it('lints a single process file as a project of its own', async () => {
      const dir = project('single-bad', { 'any/where/bad.bpmn20.xml': BAD });
      const { code, out } = await cli(join(dir, 'any/where/bad.bpmn20.xml'));
      expect(code).toBe(1);
      expect(out).toMatch(/bad\.bpmn20\.xml \[t\]\s+error\s+activiti\/no-business-rule-task/);
      expect(out).toContain('1 project(s)');
    });

    it('exits 0 for a good single file and reads the extensions sidecar next to it', async () => {
      const dir = project('single-good', { 'ok.bpmn20.xml': GOOD, 'ok-extensions.json': SIDECAR });
      const { code, out } = await cli(join(dir, 'ok.bpmn20.xml'), '--json');
      expect(code).toBe(0);
      const report = JSON.parse(out) as Array<{ project: string; problems: Array<{ rule: string; path: string }> }>;
      expect(report).toHaveLength(1);
      expect(report[0]!.project).toBe(join(dir, 'ok.bpmn20.xml'));
    });

    it('brings the extensions sidecar into the project: the problems are those of the N01 oracle', async () => {
      for (const file of ['missing-mapping.bpmn20.xml', 'business-rule-task.bpmn20.xml']) {
        const dir = join(root, `single-n01-${file}`);
        mkdirSync(dir, { recursive: true });
        cpSync(join(N01_MODELS, file), join(dir, file));
        const sidecar = file.replace(/\.bpmn20\.xml$/, '-extensions.json');
        if (existsSync(join(N01_MODELS, sidecar))) cpSync(join(N01_MODELS, sidecar), join(dir, sidecar));
        const entry = n01Oracle().files[file]!;
        if (entry.context?.length) continue; // needs files of other folders: not a single-file case
        const problems = (JSON.parse((await cli(join(dir, file), '--json')).out) as Array<{ problems: Array<{ rule: string; elementId?: string }> }>)[0]!.problems;
        expect(problems.map((p) => (p.elementId ? `${p.rule}@${p.elementId}` : p.rule)).sort(), file).toEqual([...entry.expect].sort());
      }
    });

    it('lints a DMN file', async () => {
      const dir = project('single-dmn', { 'rules.dmn': '<definitions' });
      const { code, out } = await cli(join(dir, 'rules.dmn'));
      expect(code).toBe(1);
      expect(out).toContain('rules.dmn');
    });

    it('takes several paths, files and folders mixed, and counts each as a project', async () => {
      const good = project('multi-good', { 'processes/ok.bpmn20.xml': GOOD });
      const bad = project('multi-bad', { 'processes/bad.bpmn20.xml': BAD });
      const { code, out } = await cli(join(good, 'processes/ok.bpmn20.xml'), bad, join(bad, 'processes/bad.bpmn20.xml'));
      expect(code).toBe(1);
      expect(out).toContain('3 project(s)');
      expect(out.match(/activiti\/no-business-rule-task/g)).toHaveLength(2);
    });

    it('exits 2 and says so for a path that does not exist, and for --seeds with a file', async () => {
      const missing = await cli(join(root, 'no-such-file.bpmn20.xml'));
      expect(missing.code).toBe(2);
      expect(missing.out).toContain('no such file or directory');
      const dir = project('seeds-file', { 'ok.bpmn20.xml': GOOD });
      const seeds = await cli(join(dir, 'ok.bpmn20.xml'), '--seeds');
      expect(seeds.code).toBe(2);
      expect(seeds.out).toContain('--seeds needs a corpus folder');
    });
  });

  it('--list-rules lists every rule with its severity', async () => {
    const { code, out } = await cli('--list-rules');
    expect(code).toBe(0);
    expect(out.split('\n')).toHaveLength(RULES.length);
    expect(out).toContain('activiti/no-camunda-extensions');
  });

  it('exits 2 for a wrong command line', async () => {
    expect((await cli('--nope')).code).toBe(2);
    expect((await cli()).code).toBe(2);
    expect((await cli('--help')).code).toBe(0);
  });

  it('reports a file that cannot be read as an error', async () => {
    const dir = project('broken', { 'processes/broken.bpmn20.xml': '<definitions' });
    const { code, out } = await cli(dir);
    expect(code).toBe(1);
    expect(out).toContain('activiti/bpmn-unreadable');
  });

  it('lints each N01 model as a project: the problems are those of the oracle', async () => {
    for (const [file, entry] of Object.entries(n01Oracle().files).filter(([f]) => ['business-rule-task.bpmn20.xml', 'missing-mapping.bpmn20.xml', 'call-unknown-process.bpmn20.xml', 'legacy-discount.dmn'].includes(f))) {
      const dir = join(root, `n01-${file}`);
      mkdirSync(join(dir, 'processes'), { recursive: true });
      cpSync(join(N01_MODELS, file), join(dir, 'processes', file));
      const sidecar = file.replace(/\.bpmn20\.xml$/, '-extensions.json');
      if (sidecar !== file && existsSync(join(N01_MODELS, sidecar))) cpSync(join(N01_MODELS, sidecar), join(dir, 'processes', sidecar));
      for (const c of entry.context ?? []) {
        mkdirSync(join(dir, c, '..'), { recursive: true });
        cpSync(join(N01_MODELS, 'context', c), join(dir, c));
      }
      const { out } = await cli(dir, '--json');
      const problems = (JSON.parse(out) as Array<{ problems: Array<{ rule: string; elementId?: string }> }>)[0]!.problems;
      expect(problems.map((p) => (p.elementId ? `${p.rule}@${p.elementId}` : p.rule)).sort(), file).toEqual([...entry.expect].sort());
    }
  });
});
