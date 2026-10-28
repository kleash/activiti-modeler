// @vitest-environment jsdom
import { activitiModdleExtensions, ActivitiModule, DiagramBuilder, exportProject, importProcess, type ExportableModeler, type ImportableModeler } from '@activiti-modeler/bpmn-js-activiti';
import { lintProject } from '@activiti-modeler/bpmnlint-plugin-activiti';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import colorPickerModule from 'bpmn-js-color-picker';
import { afterEach, describe, expect, it } from 'vitest';

import '../../../packages/bpmn-js-activiti/test-support/setup';

/**
 * U9: the colour picker writes `bioc:` / `color:` attributes on the diagram (DI) elements, nothing else; a coloured model exports,
 * and the lint and the export checks accept it. (The corpus project C18 runs a coloured process on the engine: ADR 0003 item 5.)
 */

const START = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_1" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="paint" name="Paint" isExecutable="true">
    <bpmn:startEvent id="start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="paint">
    <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="179" y="159" width="36" height="36" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

interface Entry {
  id: string;
  title: string;
  action: () => void;
}
interface PopupMenu {
  _getProviders(id: string): unknown[];
  _getEntries(target: unknown, providers: unknown[]): Record<string, unknown> | Entry[];
}
interface ContextPad {
  getEntries(element: unknown): Record<string, { title?: string; className?: string; action: { click: (event: unknown, element: unknown) => void } }>;
}

/** bpmn-js normalises a colour through a canvas (the browser answers `#bbdefb`); jsdom has none, so this one only knows hex colours. */
function withColorCanvas<T>(run: () => T): T {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => {
    let value = '#000000';
    return {
      // labels are laid out again when a shape changes
      font: '',
      measureText: (text: string) => ({ width: text.length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 }),
      get fillStyle() {
        return value;
      },
      set fillStyle(next: string) {
        value = /^#[0-9a-f]{6}$/i.test(next) ? next.toLowerCase() : value;
      },
    };
  }) as never;
  try {
    return run();
  } finally {
    HTMLCanvasElement.prototype.getContext = original;
  }
}

let container: HTMLElement | undefined;
let modeler: BpmnModeler | undefined;

async function open(): Promise<{ modeler: BpmnModeler; builder: DiagramBuilder }> {
  container = document.createElement('div');
  document.body.appendChild(container);
  modeler = new BpmnModeler({ container, moddleExtensions: { ...activitiModdleExtensions }, additionalModules: [ActivitiModule, colorPickerModule] } as never);
  await importProcess(modeler as unknown as ImportableModeler, { xml: START, name: 'paint' });
  const builder = new DiagramBuilder(modeler as never);
  builder.appendShape('start', { type: 'userTask', id: 'review', name: 'Review' });
  builder.appendShape('review', { type: 'endEvent', id: 'done' });
  return { modeler, builder };
}

afterEach(() => {
  modeler?.destroy();
  container?.remove();
});

const choose = (entries: Entry[], title: string): void => withColorCanvas(() => entries.find((e) => e.title === title)!.action());

const entriesOf = (m: BpmnModeler, elements: unknown[]): Entry[] => {
  const popup = m.get<PopupMenu>('popupMenu');
  const raw = popup._getEntries(elements, popup._getProviders('color-picker'));
  return (Array.isArray(raw) ? raw : Object.values(raw)) as Entry[];
};

const exportXml = async (m: BpmnModeler): Promise<{ xml: string; files: Awaited<ReturnType<typeof exportProject>>['files']; warnings: string[] }> => {
  const { files, warnings } = await exportProject(m as unknown as ExportableModeler, { project: 'paint' });
  return { xml: files.find((f) => f.path.endsWith('.bpmn20.xml'))!.content, files, warnings };
};

describe('U9 colour picker', () => {
  it('is in the context pad of an element and of a multi-selection, and offers the six colours of the picker', async () => {
    const { modeler: m } = await open();
    const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
    const pad = m.get<ContextPad>('contextPad');
    expect(pad.getEntries(registry.get('review'))['set-color']).toMatchObject({ title: 'Set color' });
    const entries = entriesOf(m, [registry.get('review'), registry.get('done')]);
    expect(entries.map((e) => e.title)).toEqual(['Default', 'Blue', 'Orange', 'Green', 'Red', 'Purple']);
  });

  it('writes bioc: and color: attributes on the diagram only, as one undoable step per choice', async () => {
    const { modeler: m } = await open();
    const registry = m.get<{ get(id: string): { di: { get(name: string): unknown; $attrs?: Record<string, string> }; businessObject: { $attrs?: Record<string, string> } } }>('elementRegistry');
    choose(entriesOf(m, [registry.get('review')]), 'Blue');
    const { xml, warnings } = await exportXml(m);
    expect(xml).toContain('xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0"');
    expect(xml).toContain('xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"');
    const shape = /<bpmndi:BPMNShape id="review_di"[^>]*>/.exec(xml)![0];
    expect(shape).toContain('bioc:stroke="#0d4372"');
    expect(shape).toContain('bioc:fill="#bbdefb"');
    expect(shape).toContain('color:background-color="#bbdefb"');
    expect(shape).toContain('color:border-color="#0d4372"');
    // the semantic element is untouched
    expect(/<bpmn:userTask id="review"[^>]*>/.exec(xml)![0]).not.toMatch(/bioc|color:/);
    expect(warnings).toEqual([]);
    expect(xml).not.toMatch(/camunda|zeebe/i);

    m.get<{ undo(): void }>('commandStack').undo();
    expect((await exportXml(m)).xml).not.toContain('bioc:');
  });

  it('a coloured model passes the export checks and the lint, and the colours come back on open', async () => {
    const { modeler: m } = await open();
    const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
    for (const [id, colour] of [['review', 'Orange'], ['start', 'Green'], ['done', 'Red']] as const) {
      choose(entriesOf(m, [registry.get(id)]), colour);
    }
    // the flows too: they are part of a multi-selection
    choose(entriesOf(m, [...(m.get<{ getAll(): Array<{ waypoints?: unknown }> }>('elementRegistry').getAll().filter((e) => e.waypoints))]), 'Purple');

    // export: the serializer checks (ADR 0003) run inside and would throw
    const { xml, files, warnings } = await exportXml(m);
    expect(warnings).toEqual([]);
    expect((xml.match(/bioc:stroke=/g) ?? []).length).toBe(5);
    expect(xml).toContain('<bpmndi:BPMNEdge');
    expect(/<bpmndi:BPMNEdge[^>]*bioc:stroke="#5b176d"/.test(xml)).toBe(true);

    // the lint: no problem about foreign attributes, nothing at error level
    const result = await lintProject(files);
    const rules = result.problems.map((p) => p.rule);
    expect(rules).not.toContain('activiti/foreign-attribute-namespace');
    expect(rules).not.toContain('activiti/no-camunda-extensions');
    expect(result.counts.error).toBe(0);
    expect(result.deployable).toBe(true);

    // and the colours are read back
    m.get<{ clear(): void }>('canvas');
    await importProcess(m as unknown as ImportableModeler, { xml, extensionsJson: files.find((f) => f.path.endsWith('-extensions.json'))!.content, name: 'paint' });
    const di = (m.get<{ get(id: string): { di: { get(name: string): unknown } } }>('elementRegistry').get('review')).di;
    expect(di.get('background-color')).toBe('#ffe0b2');
    expect(di.get('border-color')).toBe('#6b3c00');
    expect(di.get('fill')).toBe('#ffe0b2');
    expect(di.get('stroke')).toBe('#6b3c00');
  });

  it('Default takes the colours away again, so an uncoloured model has no colour attribute at all', async () => {
    const { modeler: m } = await open();
    const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
    choose(entriesOf(m, [registry.get('review')]), 'Blue');
    expect((await exportXml(m)).xml).toContain('bioc:fill');
    choose(entriesOf(m, [registry.get('review')]), 'Default');
    expect((await exportXml(m)).xml).not.toMatch(/bioc:|color:/);
  });
});
