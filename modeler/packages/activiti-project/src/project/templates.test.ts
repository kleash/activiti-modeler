import { describe, expect, it } from 'vitest';

import { parseExtensions } from '../extensions';
import { verifyBpmnXml } from '../verify';
import { classifyFile } from './kinds';
import { createFromTemplate, fileBaseName, scanDecisionIds, scanProcessIds, TEMPLATES, type TemplateId, toIdentifier } from './templates';

const ids = TEMPLATES.map((t) => t.id);

describe('templates', () => {
  it('offers the eight templates of the feature matrix', () => {
    expect(ids).toEqual(['empty-process', 'user-task-approval', 'connector-call', 'decision-task', 'dmn-decision-table', 'dmn-drd', 'scenario', 'connector-definition']);
  });

  it.each(ids)('%s creates well-formed files of the right kind', (id: TemplateId) => {
    const result = createFromTemplate(id, { name: 'demo', paths: [] });
    const info = TEMPLATES.find((t) => t.id === id)!;
    expect(result.files[0]!.path).toBe(`${info.folder}/demo${info.suffix}`);
    for (const file of result.files) {
      const kind = classifyFile(file.path);
      if (kind === 'bpmn') {
        expect(verifyBpmnXml(file.content)).toEqual({ violations: [], warnings: [] });
        expect(file.content).not.toMatch(/camunda|zeebe/i);
      } else if (kind === 'dmn') {
        const doc = new DOMParser().parseFromString(file.content, 'application/xml');
        expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
        expect(doc.documentElement.namespaceURI).toBe('https://www.omg.org/spec/DMN/20191111/MODEL/');
      } else {
        expect(() => JSON.parse(file.content)).not.toThrow();
      }
    }
  });

  it('every BPMN template comes with an extensions file that the runtime model accepts', () => {
    for (const id of ['empty-process', 'user-task-approval', 'connector-call', 'decision-task'] as const) {
      const result = createFromTemplate(id, { name: 'x', paths: [] });
      const ext = result.files.find((f) => f.path === 'processes/x-extensions.json');
      expect(ext, id).toBeDefined();
      const parsed = parseExtensions(ext!.content);
      const processId = scanProcessIds(result.files[0]!.content)[0]!;
      expect(Object.keys(parsed.extensions)).toEqual([processId]);
    }
  });

  it('the decision task points its constant at a decision id of the DMN it adds', () => {
    const result = createFromTemplate('decision-task', { name: 'route', paths: [] });
    expect(result.files[0]!.content).toContain('implementation="dmn-connector.EXECUTE_TABLE"');
    const ext = parseExtensions(result.files.find((f) => f.path.endsWith('-extensions.json'))!.content);
    const decisionId = ext.extensions['route']!.constants['decision']!['_activiti_dmn_table_']!.value;
    const dmn = result.files.find((f) => f.path.endsWith('.dmn'))!;
    expect(scanDecisionIds(dmn.content)).toContain(decisionId);
    // the inputs / outputs are mapped and the targets declared (the runtime skips undeclared targets)
    const mapping = ext.extensions['route']!.mappings['decision']!;
    expect(mapping.outputs).toEqual({ route: { type: 'VARIABLE', value: 'route' } });
    expect(Object.values(ext.extensions['route']!.properties).map((p) => p.name)).toContain('route');
  });

  it('the connector call adds the connector definition once', () => {
    const first = createFromTemplate('connector-call', { name: 'notify', paths: [] });
    expect(first.files.map((f) => f.path)).toEqual(['processes/notify.bpmn20.xml', 'processes/notify-extensions.json', 'connectors/mailer.json']);
    const second = createFromTemplate('connector-call', { name: 'other', paths: ['connectors/mailer.json'] });
    expect(second.files.map((f) => f.path)).toEqual(['processes/other.bpmn20.xml', 'processes/other-extensions.json']);
  });

  it('gives each process and decision a fresh id', () => {
    const a = createFromTemplate('empty-process', { name: 'process', paths: [] });
    expect(scanProcessIds(a.files[0]!.content)).toEqual(['Process_1']);
    const b = createFromTemplate('empty-process', { name: 'other', paths: [], processIds: ['other'] });
    expect(scanProcessIds(b.files[0]!.content)).toEqual(['other_2']);
  });

  it('refuses to overwrite the main file but never touches existing companions', () => {
    expect(() => createFromTemplate('empty-process', { name: 'a', paths: ['processes/a.bpmn20.xml'] })).toThrow(/already exists/);
    const result = createFromTemplate('empty-process', { name: 'a', paths: ['processes/a-extensions.json'] });
    expect(result.files).toHaveLength(1);
  });

  it('unique ids across templates', () => {
    const first = createFromTemplate('user-task-approval', { name: 'approval', paths: [] });
    const second = createFromTemplate('user-task-approval', { name: 'approval-2', paths: [], processIds: scanProcessIds(first.files[0]!.content) });
    expect(scanProcessIds(first.files[0]!.content)).not.toEqual(scanProcessIds(second.files[0]!.content));
    const drd1 = createFromTemplate('dmn-drd', { name: 'x', paths: [] });
    const drd2 = createFromTemplate('dmn-drd', { name: 'x', paths: [], decisionIds: scanDecisionIds(drd1.files[0]!.content) });
    expect(drd2.files).toHaveLength(1);
    expect(scanDecisionIds(drd1.files[0]!.content)).toEqual(['x_riskClass', 'x_offer']);
  });

  it('never gives the process the id of one of its elements (a file named after an element)', () => {
    for (const [id, name, element] of [['user-task-approval', 'review', 'review'], ['connector-call', 'notify', 'notify'], ['decision-task', 'decision', 'decision']] as const) {
      const xml = createFromTemplate(id, { name, paths: [] }).files[0]!.content;
      const ids = [...xml.matchAll(/<bpmn:(?!definitions|sequenceFlow)\w+ id="([^"]+)"/g)].map((m) => m[1]!);
      expect(new Set(ids).size, `${id}: ${ids.join(', ')}`).toBe(ids.length);
      expect(ids).toContain(element);
    }
  });

  it('the scenario starts the given process', () => {
    const result = createFromTemplate('scenario', { name: 'happy', paths: [], processKey: 'approval' });
    expect(JSON.parse(result.files[0]!.content).scenarios[0].start.process).toBe('approval');
  });

  it('the connector definition has a name without a dot', () => {
    const result = createFromTemplate('connector-definition', { name: 'my.conn', paths: [] });
    expect(result.files[0]!.path).toBe('connectors/my-conn.json');
    expect(JSON.parse(result.files[0]!.content).name).toBe('my-conn');
  });
});

describe('names', () => {
  it('fileBaseName strips suffixes and bad characters', () => {
    expect(fileBaseName('Order Approval.bpmn20.xml')).toBe('Order-Approval');
    expect(fileBaseName('  /x/y/risk.dmn ')).toBe('risk');
    expect(fileBaseName('???')).toBe('untitled');
  });

  it('toIdentifier gives an NCName', () => {
    expect(toIdentifier('order-approval')).toBe('order-approval');
    expect(toIdentifier('1st process')).toMatch(/^p_1st_process$/);
    expect(toIdentifier('a.b')).toBe('a_b');
  });
});
