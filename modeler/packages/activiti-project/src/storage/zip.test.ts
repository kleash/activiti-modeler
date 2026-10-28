import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { exportZip, importZip, MAX_ZIP_FILES, projectNameFromZip } from './zip';

const project = [
  { path: 'project.json', content: '{"name":"loan","version":"1.0.0"}\n' },
  { path: 'processes/loan.bpmn20.xml', content: '<?xml version="1.0"?><bpmn:definitions/>\n' },
  { path: 'processes/loan-extensions.json', content: '{\n  "id": "x"\n}\n' },
  { path: 'processes/rules.dmn', content: '<definitions/>' },
  { path: 'connectors/mailer.json', content: '{"name":"mailer"}' },
  { path: 'scenarios/happy.scenario.json', content: 'Ünïcode ✓ {}' },
];

describe('zip round trip', () => {
  it('exports the project at the root of the archive and imports exactly the same files', () => {
    const bytes = exportZip(project);
    const imported = importZip(bytes);
    expect(imported.files).toEqual([...project].sort((a, b) => (a.path < b.path ? -1 : 1)));
    expect(imported.warnings).toEqual([]);
    expect(imported.strippedFolder).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(exportZip(project)).toEqual(exportZip([...project].reverse()));
  });

  it('refuses to zip an invalid path', () => {
    expect(() => exportZip([{ path: '../x.json', content: '' }])).toThrow(/Cannot zip/);
  });
});

describe('importZip', () => {
  it('removes a wrapper folder', () => {
    const bytes = zipSync({ 'loan/project.json': strToU8('{}'), 'loan/processes/a.dmn': strToU8('<d/>') });
    const imported = importZip(bytes);
    expect(imported.files.map((f) => f.path)).toEqual(['processes/a.dmn', 'project.json']);
    expect(imported.strippedFolder).toBe('loan');
    expect(imported.warnings.join(' ')).toContain('wrapped');
  });

  it('moves the modeler-only fields of a connector file to project.json and warns (ADR 0003)', () => {
    const bytes = zipSync({
      'project.json': strToU8('{"name":"loan"}'),
      'connectors/crm.json': strToU8('{"id":"crm","name":"crm","version":"2","actions":{}}'),
    });
    const imported = importZip(bytes);
    const byPath = Object.fromEntries(imported.files.map((f) => [f.path, f.content]));
    expect(Object.keys(JSON.parse(byPath['connectors/crm.json']!) as object)).toEqual(['id', 'name', 'actions']);
    expect(JSON.parse(byPath['project.json']!)).toEqual({ name: 'loan', connectors: { crm: { version: '2' } } });
    expect(imported.warnings.join('\n')).toContain('connectors/crm.json: the field version is not read by the Activiti runtime and moved to project.json (connectors.crm)');
  });

  it('does not strip a folder when files sit at the root too', () => {
    const imported = importZip(zipSync({ 'project.json': strToU8('{}'), 'processes/a.dmn': strToU8('<d/>') }));
    expect(imported.files.map((f) => f.path)).toEqual(['processes/a.dmn', 'project.json']);
  });

  it('skips hidden, system and binary files, unsafe paths and invalid text, and says so', () => {
    const bytes = zipSync({
      'project.json': strToU8('{}'),
      '__MACOSX/._project.json': strToU8('x'),
      '.git/config.json': strToU8('{}'),
      '.DS_Store': strToU8('x'),
      'logo.png': new Uint8Array([137, 80, 78, 71]),
      '../escape.json': strToU8('{}'),
      'bad.json': new Uint8Array([0xff, 0xfe, 0xfd]),
    });
    const imported = importZip(bytes);
    expect(imported.files.map((f) => f.path)).toEqual(['project.json']);
    const text = imported.warnings.join('\n');
    expect(text).toContain('hidden or system');
    expect(text).toContain('not text');
    expect(text).toContain('"../escape.json"');
    expect(text).toContain('"bad.json"');
  });

  it('strips a byte order mark and converts backslash separators', () => {
    const bytes = zipSync({ 'project.json': strToU8('﻿{"a":1}'), 'processes\\a.dmn': strToU8('<d/>') });
    const imported = importZip(bytes);
    expect(imported.files.find((f) => f.path === 'project.json')!.content).toBe('{"a":1}');
    expect(imported.files.map((f) => f.path)).toContain('processes/a.dmn');
  });

  it('rejects data that is not a zip', () => {
    expect(() => importZip(strToU8('this is not a zip'))).toThrow(/Not a readable zip/);
  });

  it('enforces the file count limit', () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_FILES; i += 1) entries[`f${i}.json`] = strToU8('{}');
    expect(() => importZip(zipSync(entries, { level: 0 }))).toThrow(/more than 5000 files/);
  });
});

describe('projectNameFromZip', () => {
  it('prefers project.json, falls back to the file name', () => {
    expect(projectNameFromZip(project, 'whatever.zip')).toBe('loan');
    expect(projectNameFromZip([], 'My Export (3).zip')).toBe('My Export -3-');
    expect(projectNameFromZip([{ path: 'project.json', content: 'not json' }], 'a.zip')).toBe('a');
    expect(projectNameFromZip([], '.zip')).toBe('imported-project');
  });
});
