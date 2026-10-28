import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assembleProject } from './assemble';
import { emptyExtensionsFile, parseExtensions, serializeExtensions, serializeExtensionsReport, type ExtensionsFile } from './extensions';
import { findUnknownFields, listShapes, RUNTIME_MODEL, stripUnknownFields, type Shape } from './runtime-model';

interface ModelSnapshot {
  classes: Record<string, { properties: string[]; extends?: string }>;
}
const snapshot = JSON.parse(readFileSync(join(__dirname, '../support/activiti-model-fields.json'), 'utf8')) as ModelSnapshot;

/**
 * The bean properties of the Activiti 9.0.0 model classes, copied from the sources of activiti-spring-process-extensions
 * 9.0.0 (org.activiti.spring.process.model.*) and activiti-connector-model 9.0.0
 * (org.activiti.core.common.model.connector.VariableDefinition): the JavaBean setters Jackson deserialises through,
 * with `@JsonProperty("default")` on `TemplatesDefinition.defaultTemplate` applied. `Extension.getProperty(String)`,
 * `ProcessExtensionModel.getExtensions(String)` and the other getters with arguments are not properties.
 */
const JAVA_PROPERTIES: Record<string, string[]> = {
  'org.activiti.spring.process.model.ProcessExtensionModel': ['id', 'extensions'],
  'org.activiti.spring.process.model.Extension': ['properties', 'mappings', 'constants', 'templates', 'assignments'],
  'org.activiti.spring.process.model.VariableDefinition': ['id', 'name', 'description', 'type', 'required', 'display', 'displayName', 'analytics', 'ephemeral', 'value'],
  'org.activiti.spring.process.model.ProcessVariablesMapping': ['mappingType', 'inputs', 'outputs', 'ephemeral'],
  'org.activiti.spring.process.model.Mapping': ['type', 'value'],
  'org.activiti.spring.process.model.ConstantDefinition': ['value'],
  'org.activiti.spring.process.model.TemplatesDefinition': ['tasks', 'default'],
  'org.activiti.spring.process.model.TaskTemplateDefinition': ['assignee', 'candidate', 'emailNotificationEnabled'],
  'org.activiti.spring.process.model.TemplateDefinition': ['from', 'subject', 'type', 'value'],
  'org.activiti.spring.process.model.AssignmentDefinition': ['id', 'assignment', 'type', 'mode'],
};

/** Every key of a JSON document, as `$.a.b` paths with map keys kept (for walking the exported file). */
function walkKeys(value: unknown, shape: Shape, path: string, out: string[]): void {
  if (shape === 'free' || typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (shape.kind === 'map') {
      walkKeys(child, shape.value, `${path}.${key}`, out);
    } else if (key in shape.fields) {
      walkKeys(child, shape.fields[key]!, `${path}.${key}`, out);
    } else {
      out.push(`${path}.${key}`);
    }
  }
}

const everything = (): ExtensionsFile =>
  ({
    id: 'process-all',
    name: 'APA style name',
    type: 'PROCESS',
    extensions: {
      p: {
        properties: { v1: { id: 'v1', name: 'amount', type: 'integer', required: true, value: 5, description: 'd', display: true, displayName: 'Amount', analytics: false, ephemeral: false, extra: 1 } },
        mappings: {
          t: {
            mappingType: 'MAP_ALL_INPUTS',
            ephemeral: true,
            inputs: { a: { type: 'VARIABLE', value: 'x', note: 'n' } },
            outputs: { b: { type: 'VALUE', value: { nested: { keep: true } } } },
            extra: 1,
          },
        },
        constants: { t: { c: { value: 1, extra: 1 } } },
        templates: {
          default: { assignee: { type: 'VARIABLE', value: 'u', from: 'f', subject: 's', extra: 1 }, emailNotificationEnabled: false, extra: 1 },
          tasks: { t: { candidate: { type: 'FILE', value: 'f.txt' }, extra: 1 } },
          extra: 1,
        },
        assignments: { t: { id: 't', assignment: 'assignee', type: 'static', mode: 'manual', extra: 1 } },
        extra: 1,
      },
    },
    extra: 1,
  }) as ExtensionsFile;

describe('the runtime model list (ADR 0003, "Extensions rules")', () => {
  it('lists exactly the properties of the Activiti 9.0.0 classes it cites', () => {
    const listed = Object.fromEntries(listShapes().map((s) => [s.javaClass, [...s.fields].sort()]));
    expect(listed).toEqual(Object.fromEntries(Object.entries(JAVA_PROPERTIES).map(([cls, fields]) => [cls, [...fields].sort()])));
  });

  it('matches the committed snapshot of the Java field sets, on every run', () => {
    // support/activiti-model-fields.json is generated from the 9.0.0 sources by scripts/generate-model-snapshot.mjs
    const classes = snapshot.classes;
    const propertiesOf = (javaClass: string): string[] => {
      const entry = classes[javaClass];
      if (!entry) throw new Error(`${javaClass} is not in the snapshot`);
      return [...entry.properties, ...(entry.extends && classes[entry.extends] ? propertiesOf(entry.extends) : [])].sort();
    };
    const shapes = listShapes();
    expect(shapes.length).toBeGreaterThanOrEqual(10);
    for (const shape of shapes) expect([...shape.fields].sort(), shape.javaClass).toEqual(propertiesOf(shape.javaClass));
    // and the other way round: every class of the model package is either listed or known not to be an object shape
    const listed = new Set(shapes.map((s) => s.javaClass));
    expect(Object.keys(classes).filter((c) => !listed.has(c) && propertiesOf(c).length > 0 && !c.endsWith('connector.VariableDefinition')).sort()).toEqual([]);
  });

  it('has a snapshot that matches the Java sources when ACTIVITI_MODEL_SOURCES points to the unpacked 9.0.0 source jars', async (context) => {
    const root = process.env['ACTIVITI_MODEL_SOURCES'];
    if (!root) return context.skip();
    const script = await import('../scripts/generate-model-snapshot.mjs');
    const fresh = script.extractModelFields({ processExtensions: join(root, 'activiti-spring-process-extensions'), connectorModel: join(root, 'activiti-connector-model') });
    expect(snapshot).toEqual(fresh);
  });

  it('cites the root class and keeps `value` fields free-form', () => {
    expect(RUNTIME_MODEL.javaClass).toBe('org.activiti.spring.process.model.ProcessExtensionModel');
    expect(RUNTIME_MODEL.fields['id']).toBe('free');
    expect(findUnknownFields({ id: 'x', extensions: { p: { mappings: { t: { outputs: { o: { type: 'VALUE', value: { anything: { goes: [1, 2] } } } } } } } } })).toEqual([]);
  });
});

describe('unknown fields', () => {
  it('finds them at every level, with paths', () => {
    const found = findUnknownFields(everything());
    expect(found).toHaveLength(13);
    expect(found).toEqual(
      expect.arrayContaining([
        '$.name',
        '$.type',
        '$.extra',
        '$.extensions.p.extra',
        '$.extensions.p.properties.v1.extra',
        '$.extensions.p.mappings.t.extra',
        '$.extensions.p.mappings.t.inputs.a.note',
        '$.extensions.p.constants.t.c.extra',
        '$.extensions.p.templates.extra',
        '$.extensions.p.templates.default.extra',
        '$.extensions.p.templates.default.assignee.extra',
        '$.extensions.p.templates.tasks.t.extra',
        '$.extensions.p.assignments.t.extra',
      ]),
    );
  });

  it('never exports a field outside the list, whatever the loaded file carried', () => {
    const text = serializeExtensions(everything());
    const outside: string[] = [];
    walkKeys(JSON.parse(text), RUNTIME_MODEL, '$', outside);
    expect(outside).toEqual([]);
    expect(findUnknownFields(JSON.parse(text))).toEqual([]);
    const out = JSON.parse(text);
    expect(Object.keys(out)).toEqual(['id', 'extensions']);
    // everything the runtime knows is still there, including the free-form values
    expect(out.extensions.p.properties.v1).toEqual({ id: 'v1', name: 'amount', type: 'integer', required: true, value: 5, description: 'd', display: true, displayName: 'Amount', analytics: false, ephemeral: false });
    expect(out.extensions.p.mappings.t.outputs.b.value).toEqual({ nested: { keep: true } });
    expect(out.extensions.p.templates.default.emailNotificationEnabled).toBe(false);
    expect(out.extensions.p.assignments.t).toEqual({ id: 't', assignment: 'assignee', type: 'static', mode: 'manual' });
  });

  it('reports what the export dropped, and an assembled project says so in its warnings', () => {
    const { dropped } = serializeExtensionsReport(everything());
    expect(dropped).toHaveLength(13);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://activiti.org/bpmn">\n  <bpmn:process id="p" isExecutable="true">\n    <bpmn:startEvent id="s" />\n  </bpmn:process>\n</bpmn:definitions>\n';
    const { files, warnings } = assembleProject({ name: 'proj', processes: [{ name: 'all', xml, extensions: everything() }] });
    expect(warnings.filter((w) => w.includes('dropped field'))).toHaveLength(13);
    expect(warnings).toContain('all-extensions.json: dropped field $.name, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)');
    const written = JSON.parse(files.find((f) => f.path.endsWith('-extensions.json'))!.content);
    expect(findUnknownFields(written)).toEqual([]);
  });

  it('does not touch the document it strips', () => {
    const file = everything();
    const { document } = stripUnknownFields(file);
    expect(file['name']).toBe('APA style name');
    expect(document).not.toBe(file);
  });

  it('writes a fresh file without name and type, two fields the Activiti 9.0.0 ObjectMapper rejects', () => {
    const file = emptyExtensionsFile('loan', 'Process_1');
    expect(file).toEqual({ id: 'process-loan', extensions: { Process_1: { properties: {}, mappings: {}, constants: {} } } });
    expect(Object.keys(JSON.parse(serializeExtensions(file)))).toEqual(['id', 'extensions']);
  });

  it('parses a file with top-level name and type but writes it without them', () => {
    const parsed = parseExtensions('{"id":"x","type":"PROCESS","name":"n","extensions":{}}');
    expect(findUnknownFields(parsed)).toEqual(['$.type', '$.name']);
    expect(JSON.parse(serializeExtensions(parsed))).toEqual({ id: 'x', extensions: {} });
  });

  it('quotes map keys that are not identifiers in the path', () => {
    expect(findUnknownFields({ extensions: { 'my-process': { mappings: { 'task 1': { bogus: 1 } } } } })).toEqual(['$.extensions["my-process"].mappings["task 1"].bogus']);
  });
});
