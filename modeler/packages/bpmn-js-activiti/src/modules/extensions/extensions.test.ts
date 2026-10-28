import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionsFile, parseExtensions } from '@activiti-modeler/activiti-project';
import { afterEach, describe, expect, it } from 'vitest';

import { exportProcess, importProcess } from '../../export';
import { createBuilt, type Built } from '../../../test-support/builder';
import { EMPTY_PROCESS } from '../../../test-support/modeler';
import { EXTENSIONS_CHANGED, type ExtensionsStore } from '.';

let t: Built | undefined;
let other: Built | undefined;
afterEach(() => {
  t?.destroy();
  other?.destroy();
  t = other = undefined;
});

const store = (b: Built): ExtensionsStore => b.get<ExtensionsStore>('extensionsStore');
const snapshot = (b: Built): string => JSON.stringify(store(b).model);
const EMPTY_EXT = { properties: {}, mappings: {}, constants: {} } as const;
/** The entry of a process; a process without any entry reads as empty. */
const ext = (b: Built, processId = 'Process_1'): NonNullable<ReturnType<ExtensionsStore['getProcess']>> => store(b).getProcess(processId) ?? EMPTY_EXT;
const bo = (b: Built, id: string): { id: string } => b.element(id).businessObject as unknown as { id: string };

/** A process with a service task that has every kind of entry the store keys by element id. */
async function withEntries(): Promise<Built> {
  const b = await createBuilt();
  b.builder.createShape({ type: 'userTask', id: 'task' });
  b.builder.createShape({ type: 'serviceTask', id: 'svc' });
  const s = store(b);
  s.update('seed', (file) => {
    const p = (file.extensions['Process_1'] ??= { properties: {}, mappings: {}, constants: {} });
    p.mappings['task'] = { inputs: { a: { type: 'VARIABLE', value: 'x' } } };
    p.mappings['svc'] = { mappingType: 'MAP_ALL' };
    p.constants['task'] = { k: { value: 1 } };
    p.assignments = { task: { id: 'task', assignment: 'assignee', type: 'static' } };
    p.templates = { default: {}, tasks: { task: { assignee: { type: 'VARIABLE', value: 'u' } } } };
  });
  b.commandStack.clear();
  return b;
}

describe('commands and undo / redo', () => {
  it('setMapping, setConstants and setProperties are single undoable commands that fire change events', async () => {
    t = await createBuilt();
    const events: string[] = [];
    t.get<{ on(type: string, handler: (e: { reason: string }) => void): void }>('eventBus').on(EXTENSIONS_CHANGED, (e) => events.push(e.reason));
    const s = store(t);
    s.setMapping('Process_1', 'StartEvent_1', { inputs: { a: { type: 'VALUE', value: 1 } } }, { declare: false });
    s.setConstants('Process_1', 'StartEvent_1', { c: { value: 'x' } });
    s.setProperties('Process_1', { p1: { id: 'p1', name: 'amount', type: 'integer' } });
    expect(events).toEqual(['set mapping of StartEvent_1', 'set constants of StartEvent_1', 'set process variables']);
    const after = snapshot(t);
    t.commandStack.undo();
    t.commandStack.undo();
    t.commandStack.undo();
    expect(ext(t).properties).toEqual({});
    expect(ext(t).constants).toEqual({});
    expect(ext(t).mappings).toEqual({});
    t.commandStack.redo();
    t.commandStack.redo();
    t.commandStack.redo();
    expect(snapshot(t)).toBe(after);
  });

  it('keeps a generated id stable across redo', async () => {
    t = await createBuilt();
    store(t).setMapping('Process_1', 'StartEvent_1', { outputs: { out: { type: 'VALUE', value: 3 } } });
    const id = Object.keys(ext(t).properties)[0]!;
    t.commandStack.undo();
    expect(ext(t).properties).toEqual({});
    t.commandStack.redo();
    expect(Object.keys(ext(t).properties)).toEqual([id]);
  });

  it('shares one history with XML edits', async () => {
    t = await createBuilt();
    t.modeling.updateProperties(t.element('StartEvent_1'), { name: 'Begin' });
    store(t).setConstants('Process_1', 'StartEvent_1', { c: { value: 1 } });
    t.modeling.updateProperties(t.element('StartEvent_1'), { name: 'Start' });
    t.commandStack.undo();
    expect(t.element('StartEvent_1').businessObject.get('name')).toBe('Begin');
    expect(ext(t).constants['StartEvent_1']).toBeDefined();
    t.commandStack.undo();
    expect(ext(t)?.constants['StartEvent_1']).toBeUndefined();
    expect(t.element('StartEvent_1').businessObject.get('name')).toBe('Begin');
    t.commandStack.undo();
    expect(t.element('StartEvent_1').businessObject.get('name')).toBeUndefined();
  });
});

describe('element id changes', () => {
  it('renames mappings, constants, assignments and templates.tasks keys with the element, in one undo step', async () => {
    t = await withEntries();
    const before = snapshot(t);
    t.modeling.updateProperties(t.element('task'), { id: 'review' });
    const p = ext(t);
    expect(Object.keys(p.mappings)).toEqual(['review', 'svc']);
    expect(Object.keys(p.constants)).toEqual(['review']);
    expect(p.assignments).toEqual({ review: { id: 'review', assignment: 'assignee', type: 'static' } });
    expect(Object.keys(p.templates!.tasks!)).toEqual(['review']);
    t.commandStack.undo();
    expect(snapshot(t)).toBe(before);
    expect(bo(t, 'task').id).toBe('task');
    t.commandStack.redo();
    expect(Object.keys(ext(t).mappings)).toEqual(['review', 'svc']);
  });

  it('renames through the accessor, which validates the id', async () => {
    t = await withEntries();
    t.builder.setProperty('task', 'general.id', 'approve');
    expect(Object.keys(ext(t).mappings)).toContain('approve');
    expect(() => t!.builder.setProperty('approve', 'general.id', 'bad id')).toThrow('not a valid NCName');
    expect(() => t!.builder.setProperty('approve', 'general.id', 'svc')).toThrow('already used');
    expect(Object.keys(ext(t).mappings)).toContain('approve');
  });

  it('ignores ids of elements without entries', async () => {
    t = await withEntries();
    const before = snapshot(t);
    t.modeling.updateProperties(t.element('StartEvent_1'), { id: 'begin' });
    expect(snapshot(t)).toBe(before);
    expect(t.commandStack.canUndo()).toBe(true);
  });

  it('renames the top-level key when the process id changes', async () => {
    t = await withEntries();
    t.modeling.updateProperties(t.element('Process_1'), { id: 'loan' });
    expect(Object.keys(store(t).model.extensions)).toEqual(['loan']);
    expect(Object.keys(ext(t, 'loan').mappings)).toEqual(['task', 'svc']);
    t.commandStack.undo();
    expect(Object.keys(store(t).model.extensions)).toEqual(['Process_1']);
  });

  it('renames the top-level key when the process of a participant gets a new id', async () => {
    t = await createBuilt();
    const pool = t.builder.createShape({ type: 'participant', id: 'Pool_1', name: 'Bank' });
    const svc = t.builder.createShape({ type: 'serviceTask', id: 'svc', parent: pool });
    t.builder.createLane(pool, { id: 'Lane_2', name: 'Back office' });
    t.builder.setMapping(svc, { mappingType: 'MAP_ALL' });
    const processId = (t.element(pool).businessObject.get('processRef') as { id: string }).id;
    expect(Object.keys(ext(t, processId).mappings)).toEqual(['svc']);
    const before = snapshot(t);
    const processRef = t.element(pool).businessObject.get('processRef');
    t.modeling.updateModdleProperties(t.element(pool), processRef as never, { id: 'bank_process' });
    expect(Object.keys(store(t).model.extensions)).toEqual(['bank_process']);
    t.commandStack.undo();
    expect(snapshot(t)).toBe(before);
    expect(t.element('Lane_2')).toBeDefined();
  });

  it('keeps entries of elements in a sub process under the process key', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'subProcess', id: 'sp' });
    t.builder.createShape({ type: 'serviceTask', id: 'inner', parent: 'sp' });
    t.builder.setMapping('inner', { mappingType: 'MAP_ALL' });
    t.modeling.updateProperties(t.element('inner'), { id: 'inner2' });
    expect(Object.keys(ext(t).mappings)).toEqual(['inner2']);
  });
});

describe('deleting elements', () => {
  it('removes the entries of a deleted element and brings them back on undo', async () => {
    t = await withEntries();
    const before = snapshot(t);
    t.modeling.removeElements([t.element('task')]);
    const p = ext(t);
    expect(Object.keys(p.mappings)).toEqual(['svc']);
    expect(p.constants).toEqual({});
    expect(p.assignments).toEqual({});
    expect(p.templates!.tasks).toEqual({});
    t.commandStack.undo();
    expect(snapshot(t)).toBe(before);
    t.commandStack.redo();
    expect(Object.keys(ext(t).mappings)).toEqual(['svc']);
  });

  it('removes the entries of every element inside a deleted sub process', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'subProcess', id: 'sp' });
    t.builder.createShape({ type: 'serviceTask', id: 'a', parent: 'sp' });
    t.builder.createShape({ type: 'userTask', id: 'b', parent: 'sp' });
    t.builder.setMapping('a', { mappingType: 'MAP_ALL' });
    t.builder.setConstants('b', { x: 1 });
    t.builder.setMapping('sp', undefined);
    t.modeling.removeElements([t.element('sp')]);
    expect(ext(t).mappings).toEqual({});
    expect(ext(t).constants).toEqual({});
    t.commandStack.undo();
    // `b` is a new user task: it has the default MAP_ALL mapping next to the one set for `a`
    expect(Object.keys(ext(t).mappings).sort()).toEqual(['a', 'b']);
    expect(Object.keys(ext(t).constants)).toEqual(['b']);
  });

  it('keeps the entries when an element is replaced by another type (bpmn-js deletes and recreates it)', async () => {
    t = await withEntries();
    const before = snapshot(t);
    const replaced = t.get<{ replaceElement(el: unknown, target: Record<string, unknown>): { id: string } }>('bpmnReplace').replaceElement(t.element('task'), { type: 'bpmn:ServiceTask' });
    expect(replaced.id).toBe('task');
    expect(snapshot(t)).toBe(before);
    t.commandStack.undo();
    expect(snapshot(t)).toBe(before);
  });

  it('leaves entries alone when a connection is deleted', async () => {
    t = await withEntries();
    t.builder.connect('task', 'svc', { id: 'flow' });
    const before = snapshot(t);
    t.modeling.removeElements([t.element('flow')]);
    expect(snapshot(t)).toBe(before);
  });
});

describe('copy and paste', () => {
  const paste = (b: Built, ids: string[]): string[] => {
    const copyPaste = b.get<{ copy(elements: unknown[]): void; paste(context: Record<string, unknown>): void }>('copyPaste');
    const before = new Set(b.registry.getAll().map((e) => e.id));
    copyPaste.copy(ids.map((id) => b.element(id)));
    copyPaste.paste({ element: b.get<{ getRootElement(): unknown }>('canvas').getRootElement(), point: { x: 900, y: 500 } });
    return b.registry.getAll().filter((e) => !before.has(e.id) && !e.waypoints && !e.labelTarget).map((e) => e.id);
  };

  it('copies entries to the pasted element under its new id, in one undo step', async () => {
    t = await withEntries();
    const before = snapshot(t);
    const [newId] = paste(t, ['task']);
    expect(newId).toBeDefined();
    expect(newId).not.toBe('task');
    const p = ext(t);
    expect(p.mappings[newId!]).toEqual(p.mappings['task']);
    expect(p.mappings[newId!]).not.toBe(p.mappings['task']);
    expect(p.constants[newId!]).toEqual({ k: { value: 1 } });
    expect((p.assignments![newId!] as { id: string }).id).toBe(newId);
    expect(Object.keys(p.templates!.tasks!).sort()).toEqual(['task', newId!].sort());
    t.commandStack.undo();
    expect(snapshot(t)).toBe(before);
    t.commandStack.redo();
    expect(ext(t).mappings[newId!]).toBeDefined();
  });

  it('pastes entries into another diagram, under the other process key', async () => {
    t = await withEntries();
    other = await createBuilt(EMPTY_PROCESS.replace(/Process_1/g, 'Other'));
    const copyPaste = t.get<{ copy(elements: unknown[]): void }>('copyPaste');
    copyPaste.copy([t.element('svc')]);
    // the shell shares the clipboard between editors; bpmn-js keeps one per editor
    other.get<{ set(content: unknown): void }>('clipboard').set(t.get<{ get(): unknown }>('clipboard').get());
    const target = other.get<{ paste(context: Record<string, unknown>): void }>('copyPaste');
    const before = new Set(other.registry.getAll().map((e) => e.id));
    target.paste({ element: other.get<{ getRootElement(): unknown }>('canvas').getRootElement(), point: { x: 600, y: 400 } });
    const created = other.registry.getAll().filter((e) => !before.has(e.id) && !e.waypoints && !e.labelTarget).map((e) => e.id);
    expect(created).toHaveLength(1);
    expect(ext(other, 'Other').mappings[created[0]!]).toEqual({ mappingType: 'MAP_ALL' });
  });
});

describe('declared properties for output mappings', () => {
  it('declares an output target once, typed from a literal, and json otherwise', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.setProperty('svc', 'mapping.outputs', {
      count: { type: 'VALUE', value: 3 },
      payload: { type: 'VARIABLE', value: 'response' },
      typed: { type: 'VARIABLE', value: 'amount', declareType: 'bigdecimal' },
    });
    const props = Object.values(ext(t).properties);
    expect(props.map((p) => [p.name, p.type]).sort()).toEqual([['count', 'integer'], ['payload', 'json'], ['typed', 'bigdecimal']]);
    t.builder.setProperty('svc', 'mapping.outputs', { count: { type: 'VALUE', value: 4 } });
    expect(Object.values(ext(t).properties)).toHaveLength(3);
    t.commandStack.undo();
    t.commandStack.undo();
    expect(Object.values(ext(t).properties)).toEqual([]);
  });
});

// naming a shape adds an empty BPMNLabel to its DI that undo leaves behind; it carries no information
const normalize = (xml: string | undefined): string => (xml ?? '').replace(/<bpmndi:BPMNLabel\b[^>]*?(?:\/>|>[\s\S]*?<\/bpmndi:BPMNLabel>)/g, '');

describe('undo / redo sequences across XML and JSON edits', () => {
  it('replays a mixed sequence exactly in both directions', async () => {
    t = await withEntries();
    const states: Array<{ json: string; xml: string }> = [];
    const capture = async (): Promise<void> => {
      states.push({ json: snapshot(t!), xml: normalize((await t!.modeler.saveXML({ format: false })).xml) });
    };
    await capture();
    t.builder.setProperty('svc', 'impl.type', 'connector');
    await capture();
    t.builder.setProperty('svc', 'impl.connector', 'mailer.SEND');
    await capture();
    t.builder.setProperty('svc', 'mapping.outputs', { sent: { type: 'VALUE', value: true } });
    await capture();
    t.modeling.updateProperties(t.element('svc'), { id: 'send_mail' });
    await capture();
    t.builder.setConstants('send_mail', { subject: 'Hi' });
    await capture();
    t.modeling.removeElements([t.element('send_mail')]);
    await capture();
    t.builder.setProperty('task', 'general.name', 'Review');
    await capture();

    for (let i = states.length - 2; i >= 0; i--) {
      t.commandStack.undo();
      expect({ json: snapshot(t), xml: normalize((await t.modeler.saveXML({ format: false })).xml) }, `after undo to state ${i}`).toEqual(states[i]);
    }
    expect(t.commandStack.canUndo()).toBe(false);
    for (let i = 1; i < states.length; i++) {
      t.commandStack.redo();
      expect({ json: snapshot(t), xml: normalize((await t.modeler.saveXML({ format: false })).xml) }, `after redo to state ${i}`).toEqual(states[i]);
    }
  });
});

describe('document handling', () => {
  it('serialises an entry for every process, warns about fields the runtime does not know on import and drops them on export', async () => {
    t = await createBuilt();
    const json = '{"id":"x","name":"n","type":"PROCESS","bogusTop":1,"extensions":{"Process_1":{"bogus":true,"mappings":{"StartEvent_1":{"mappingType":"map_all","bogusM":1}}}}}';
    const { warnings } = await importProcess(t.modeler as never, { xml: EMPTY_PROCESS, extensionsJson: json, name: 'loan' });
    expect(warnings).toEqual([
      'loan-extensions.json: field $.name is not known to Activiti 9.0.0 and will be dropped on export',
      'loan-extensions.json: field $.type is not known to Activiti 9.0.0 and will be dropped on export',
      'loan-extensions.json: field $.bogusTop is not known to Activiti 9.0.0 and will be dropped on export',
      'loan-extensions.json: field $.extensions.Process_1.bogus is not known to Activiti 9.0.0 and will be dropped on export',
      'loan-extensions.json: field $.extensions.Process_1.mappings.StartEvent_1.bogusM is not known to Activiti 9.0.0 and will be dropped on export',
    ]);
    // the loaded document still has them (nothing changes behind the user's back) ...
    expect(store(t).unknownFields()).toHaveLength(5);
    // ... the exported one does not, and the export says so
    const out = JSON.parse(store(t).serialize(['Process_1', 'Process_2']));
    expect(out).toEqual({
      id: 'x',
      extensions: {
        Process_1: { properties: {}, mappings: { StartEvent_1: { mappingType: 'map_all' } }, constants: {} },
        Process_2: { properties: {}, mappings: {}, constants: {} },
      },
    });
    const exported = await exportProcess(t.modeler as never, 'loan');
    expect(exported.warnings.filter((w) => w.includes('dropped field'))).toEqual([
      'loan-extensions.json: dropped field $.name, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)',
      'loan-extensions.json: dropped field $.type, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)',
      'loan-extensions.json: dropped field $.bogusTop, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)',
      'loan-extensions.json: dropped field $.extensions.Process_1.bogus, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)',
      'loan-extensions.json: dropped field $.extensions.Process_1.mappings.StartEvent_1.bogusM, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)',
    ]);
    expect(Object.keys(JSON.parse(exported.extensionsJson))).toEqual(['id', 'extensions']);
  });

  it('resets when a new diagram is imported and loads the file that goes with it', async () => {
    t = await withEntries();
    expect(Object.keys(ext(t).mappings)).toHaveLength(2);
    await t.modeler.importXML(EMPTY_PROCESS);
    expect(store(t).getProcess('Process_1')).toBeUndefined();
    store(t).load(readFileSync(join(__dirname, '../../../../activiti-moddle/test/fixtures/lab/t17m-extensions.json'), 'utf8').replace(/t17m/g, 'Process_1'));
    expect(Object.values(ext(t).properties).map((p) => p.name)).toEqual(['result', 'inVar']);
  });

  it('names a generated document after the exported file', async () => {
    t = await createBuilt();
    const exported = await t.builder.export('loan');
    // an APA-style top-level `name` / `type` makes Activiti 9.0.0 fail with UnrecognizedPropertyException
    expect(JSON.parse(exported.extensionsJson)).toEqual({ id: 'process-loan', extensions: { Process_1: { properties: {}, mappings: {}, constants: {} } } });
    expect(exported.warnings).toEqual([]);
  });

  it('round-trips every runtime extension sample through load and serialize unchanged in meaning', () => {
    const dirs = [join(__dirname, '../../../../activiti-moddle/test/fixtures/lab'), join(__dirname, '../../../../activiti-moddle/test/fixtures/runtime-samples')];
    let count = 0;
    for (const dir of dirs) {
      for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const text = readFileSync(join(dir, name), 'utf8');
        const parsed: ExtensionsFile = parseExtensions(text);
        const again = JSON.parse(JSON.stringify(parsed));
        // everything of the original is still there after normalisation
        const original = JSON.parse(text);
        for (const [processId, extension] of Object.entries(original.extensions ?? {}) as Array<[string, Record<string, unknown>]>) {
          for (const [key, value] of Object.entries(extension)) expect(again.extensions[processId][key], `${name} ${processId}.${key}`).toEqual(value);
        }
        count += 1;
      }
    }
    expect(count).toBeGreaterThanOrEqual(15);
  });
});
