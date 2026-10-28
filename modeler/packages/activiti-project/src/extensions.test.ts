import { describe, expect, it } from 'vitest';

import {
  declareOutputTargets, emptyExtensionsFile, emptyProcessExtension, findPropertyByName, inferTypeFromLiteral, keyedElementIds,
  parseExtensions, readElementEntries, removeElementKey, renameElementKey, serializeExtensions, writeElementEntries,
  type ProcessExtension,
} from './extensions';

const sample = (): ProcessExtension => ({
  properties: {},
  mappings: { t1: { inputs: { a: { type: 'VARIABLE', value: 'x' } } }, t2: { mappingType: 'MAP_ALL' } },
  constants: { t1: { k: { value: 1 } } },
  assignments: { t1: { id: 't1', assignment: 'assignee', type: 'static' } },
  templates: { default: {}, tasks: { t1: { assignee: { type: 'VARIABLE', value: 'u' } } } },
});

describe('parse and serialize', () => {
  it('normalises missing maps and keeps unknown fields in memory, but does not write them', () => {
    const file = parseExtensions('{"id":"e","bogusTop":1,"extensions":{"p":{"bogus":true,"mappings":{"s":{"mappingType":"map_all","bogusM":1}}}}}');
    expect(file.extensions['p']!.properties).toEqual({});
    expect(file.extensions['p']!.constants).toEqual({});
    expect(file['bogusTop']).toBe(1);
    expect(file.extensions['p']!['bogus']).toBe(true);
    const out = JSON.parse(serializeExtensions(file));
    expect(out.bogusTop).toBeUndefined();
    expect(out.extensions.p.bogus).toBeUndefined();
    expect(out.extensions.p.mappings.s).toEqual({ mappingType: 'map_all' });
  });

  it('writes the runtime fields in a fixed order and nothing else', () => {
    const file = parseExtensions('{"zzz":1,"extensions":{"p":{"z":1,"constants":{},"mappings":{},"properties":{}}},"type":"PROCESS","name":"n","id":"i"}');
    const text = serializeExtensions(file);
    expect(Object.keys(JSON.parse(text))).toEqual(['id', 'extensions']);
    expect(Object.keys(JSON.parse(text).extensions.p)).toEqual(['properties', 'mappings', 'constants']);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('orders the fields of properties and mappings the way the runtime samples do', () => {
    const file = parseExtensions('{"extensions":{"p":{"properties":{"a":{"name":"x","zzz":1,"type":"string","id":"a","required":true}},"mappings":{"t":{"outputs":{},"inputs":{},"mappingType":"MAP_ALL","ephemeral":true}}}}}');
    const out = JSON.parse(serializeExtensions(file));
    expect(Object.keys(out.extensions.p.properties.a)).toEqual(['id', 'name', 'type', 'required']);
    expect(Object.keys(out.extensions.p.mappings.t)).toEqual(['mappingType', 'ephemeral', 'inputs', 'outputs']);
  });

  it('creates a valid empty file and rejects non-objects', () => {
    const file = emptyExtensionsFile('loan', 'Process_1');
    expect(file).toEqual({ id: 'process-loan', extensions: { Process_1: emptyProcessExtension() } });
    expect(() => parseExtensions('[]')).toThrow('top level must be an object');
    expect(() => parseExtensions('{nope')).toThrow('Invalid extensions JSON');
  });
});

describe('element keys', () => {
  it('renames in mappings, constants, assignments (and their id) and templates.tasks, keeping order', () => {
    const ext = sample();
    expect(renameElementKey(ext, 't1', 'task_one')).toBe(true);
    expect(Object.keys(ext.mappings)).toEqual(['task_one', 't2']);
    expect(Object.keys(ext.constants)).toEqual(['task_one']);
    expect(ext.assignments).toEqual({ task_one: { id: 'task_one', assignment: 'assignee', type: 'static' } });
    expect(Object.keys(ext.templates!.tasks!)).toEqual(['task_one']);
    expect(keyedElementIds(ext)).toEqual(['t2', 'task_one']);
  });

  it('does nothing for unknown or identical ids', () => {
    const ext = sample();
    expect(renameElementKey(ext, 'nope', 'x')).toBe(false);
    expect(renameElementKey(ext, 't1', 't1')).toBe(false);
  });

  it('removes every entry of an element', () => {
    const ext = sample();
    expect(removeElementKey(ext, 't1')).toBe(true);
    expect(keyedElementIds(ext)).toEqual(['t2']);
    expect(removeElementKey(ext, 't1')).toBe(false);
  });

  it('copies entries to another id without aliasing', () => {
    const ext = sample();
    const entries = readElementEntries(ext, 't1');
    expect(writeElementEntries(ext, 't9', entries)).toBe(true);
    expect(ext.mappings['t9']).toEqual(ext.mappings['t1']);
    expect(ext.mappings['t9']).not.toBe(ext.mappings['t1']);
    expect((ext.assignments!['t9'] as { id: string }).id).toBe('t9');
    expect(Object.keys(ext.templates!.tasks!).sort()).toEqual(['t1', 't9']);
    ext.mappings['t9']!.inputs!['a']!.value = 'changed';
    expect(ext.mappings['t1']!.inputs!['a']!.value).toBe('x');
  });
});

describe('declaring output targets', () => {
  let n = 0;
  const id = (): string => `id-${++n}`;

  it('infers the type from literal values and falls back to json', () => {
    expect(inferTypeFromLiteral(true)).toBe('boolean');
    expect(inferTypeFromLiteral(3)).toBe('integer');
    expect(inferTypeFromLiteral(3.5)).toBe('bigdecimal');
    expect(inferTypeFromLiteral('s')).toBe('string');
    expect(inferTypeFromLiteral([1])).toBe('array');
    expect(inferTypeFromLiteral({ a: 1 })).toBe('json');
    expect(inferTypeFromLiteral(null)).toBeUndefined();
  });

  it('declares each undeclared target once with the best known type', () => {
    const ext = emptyProcessExtension();
    ext.properties['p0'] = { id: 'p0', name: 'already', type: 'string' };
    const added = declareOutputTargets(
      ext,
      {
        outputs: {
          already: { type: 'VARIABLE', value: 'r0' },
          lit: { type: 'VALUE', value: 7 },
          fromConnector: { type: 'VARIABLE', value: 'amount' },
          unknown: { type: 'VARIABLE', value: 'something' },
          patch: { type: 'JSONPATCH', value: [] },
        },
      },
      id,
      { sourceTypes: { amount: 'bigdecimal' } },
    );
    expect(added).toEqual(['lit', 'fromConnector', 'unknown', 'patch']);
    expect(findPropertyByName(ext, 'lit')).toMatchObject({ type: 'integer', required: false });
    expect(findPropertyByName(ext, 'fromConnector')?.type).toBe('bigdecimal');
    expect(findPropertyByName(ext, 'unknown')?.type).toBe('json');
    expect(findPropertyByName(ext, 'patch')?.type).toBe('json');
    expect(findPropertyByName(ext, 'already')?.id).toBe('p0');
    // idempotent
    expect(declareOutputTargets(ext, { outputs: { lit: { type: 'VALUE', value: 1 } } }, id)).toEqual([]);
  });
});
