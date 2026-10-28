// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { installSvgPolyfills } from '../../../../packages/bpmn-js-activiti/test-support/jsdom-svg';
import { createDmnModeler, emptyDmnXml } from './dmnModeler';
import { ActivitiDmnPanelFilter, getDmnPanel, setDmnPanel, subscribeDmnPanel } from './dmnPanel';

installSvgPolyfills();
HTMLCanvasElement.prototype.getContext = (() => null) as never;
// the panel renders as soon as a diagram is imported, and its groups watch their visibility
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" id="Definitions_a" name="a" namespace="http://activiti.org/schema/1.0/dmn/Definitions_a">
  <inputData id="InputData_x" name="x"><variable id="InputData_x_variable" name="x" typeRef="number" /></inputData>
  <decision id="d" name="D"><variable id="d_variable" name="D" typeRef="string" />
    <literalExpression id="d_expr"><text>"a"</text></literalExpression>
  </decision>
  <dmndi:DMNDI><dmndi:DMNDiagram id="DMNDiagram_1">
    <dmndi:DMNShape id="s1" dmnElementRef="d"><dc:Bounds height="80" width="180" x="160" y="100" /></dmndi:DMNShape>
    <dmndi:DMNShape id="s2" dmnElementRef="InputData_x"><dc:Bounds height="45" width="125" x="187" y="280" /></dmndi:DMNShape>
  </dmndi:DMNDiagram></dmndi:DMNDI>
</definitions>`;

type Group = { id: string; entries: Array<{ id: string }> };
interface DrdViewer {
  get(name: string): { get(id: string): unknown; _getProviders?: () => Array<{ getGroups(element: unknown): (groups: Group[]) => Group[] }> };
}

async function groupsOf(elementId: string): Promise<Group[]> {
  const modeler = createDmnModeler({ container: document.body.appendChild(document.createElement('div')) });
  await modeler.importXML(XML);
  const viewer = modeler.getActiveViewer() as unknown as DrdViewer;
  const registry = viewer.get('elementRegistry');
  const panel = viewer.get('propertiesPanel') as unknown as { _getProviders(): Array<{ getGroups(element: unknown): (groups: Group[]) => Group[] }> };
  const element = registry.get(elementId) as { businessObject: unknown };
  const providers = panel._getProviders();
  return providers.reduce<Group[]>((groups, provider) => provider.getGroups(element)(groups), []);
}

describe('the properties panel of the DRD', () => {
  it('offers general (name, id), documentation (description) and variable (type) for a decision, and nothing about Camunda or Zeebe', async () => {
    const groups = await groupsOf('d');
    expect(groups.map((g) => g.id)).toEqual(['general', 'documentation', 'variable']);
    expect(groups.find((g) => g.id === 'general')!.entries.map((e) => e.id)).toEqual(['name', 'id']);
    expect(groups.find((g) => g.id === 'documentation')!.entries.map((e) => e.id)).toEqual(['description']);
  });

  it('leaves out the question and the allowed answers of a decision, which Activiti does not read', async () => {
    const ids = (await groupsOf('d')).flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).not.toContain('question');
    expect(ids).not.toContain('allowedAnswers');
  });

  it('offers the same groups for input data', async () => {
    const groups = await groupsOf('InputData_x');
    expect(groups.map((g) => g.id)).toEqual(['general', 'documentation', 'variable']);
  });

  it('the filter drops a group that has no entries left and keeps groups without entries lists', () => {
    const registered: Array<[number, unknown]> = [];
    const filter = new ActivitiDmnPanelFilter({ registerProvider: (priority, provider) => void registered.push([priority, provider]) });
    expect(registered).toEqual([[500, filter]]);
    const out = filter.getGroups()([
      { id: 'documentation', entries: [{ id: 'question' }, { id: 'allowedAnswers' }] },
      { id: 'general', entries: [{ id: 'name' }] },
      { id: 'plain' },
    ]);
    expect(out.map((g) => g.id)).toEqual(['general', 'plain']);
  });

  it('is not part of the empty file the editor starts from, only of the DRD viewer (no Camunda or Zeebe provider is loaded)', async () => {
    const modeler = createDmnModeler({ container: document.body.appendChild(document.createElement('div')) });
    await modeler.importXML(emptyDmnXml('Definitions_e', 'e'));
    const viewer = modeler.getActiveViewer() as unknown as { get(name: string, strict?: boolean): unknown };
    expect(viewer.get('dmnPropertiesProvider', false)).toBeTruthy();
    expect(viewer.get('camundaPropertiesProvider', false)).toBeFalsy();
    expect(viewer.get('zeebePropertiesProvider', false)).toBeFalsy();
  });

  it('leaves the panel out when asked to, and the model is the same', async () => {
    const modeler = createDmnModeler({ container: document.body.appendChild(document.createElement('div')), propertiesPanel: false });
    await modeler.importXML(XML);
    const viewer = modeler.getActiveViewer() as unknown as { get(name: string, strict?: boolean): unknown };
    expect(viewer.get('propertiesPanel', false)).toBeFalsy();
    expect((await modeler.saveXML()).xml).toContain('<decision id="d"');
  });

  it('the shell follows the panel announced by the visible DMN tab', () => {
    const seen: unknown[] = [];
    const stop = subscribeDmnPanel(() => void seen.push(getDmnPanel()));
    const panel = { attachTo: () => undefined, detach: () => undefined };
    setDmnPanel(panel);
    setDmnPanel(panel);
    setDmnPanel(undefined);
    stop();
    expect(seen).toEqual([panel, undefined]);
  });
});
