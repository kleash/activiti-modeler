// @vitest-environment jsdom
import { activitiModdleExtensions, ActivitiModule, DiagramBuilder, importProcess, type ExtensionsStore, type ProjectCatalog, type ProjectCatalogData } from '@activiti-modeler/bpmn-js-activiti';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import { afterEach, describe, expect, it } from 'vitest';

import '../../../packages/bpmn-js-activiti/test-support/setup';
import { ActivitiVariablesModule, type ActivitiVariable } from './ActivitiVariableResolver';
import { highlight, READER_MARKER, readRows, WRITER_MARKER } from './VariablesPanel';

/** U14: the Activiti adapter of @bpmn-io/variable-resolver and the rows of the outline. */

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_1" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="orders" name="Orders" isExecutable="true">
    <bpmn:startEvent id="start" activiti:initiator="starter"/>
    <bpmn:serviceTask id="decide" name="Decide risk" implementation="dmn-connector.EXECUTE_TABLE"/>
    <bpmn:scriptTask id="price" name="Price" scriptFormat="juel" activiti:resultVariable="total"><bpmn:script>\${amount * 2}</bpmn:script></bpmn:scriptTask>
    <bpmn:userTask id="approve" name="Approve" activiti:assignee="\${manager}">
      <bpmn:multiInstanceLoopCharacteristics activiti:collection="approvers" activiti:elementVariable="approver"/>
    </bpmn:userTask>
    <bpmn:callActivity id="ship" name="Ship" calledElement="shipping"><bpmn:extensionElements><activiti:in source="total" target="sum"/><activiti:out source="label" target="shippingLabel"/></bpmn:extensionElements></bpmn:callActivity>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="decide"/>
    <bpmn:sequenceFlow id="f2" sourceRef="decide" targetRef="price"/>
    <bpmn:sequenceFlow id="f3" sourceRef="price" targetRef="approve"/>
    <bpmn:sequenceFlow id="f4" sourceRef="approve" targetRef="ship"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="orders">
    <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="decide_di" bpmnElement="decide"><dc:Bounds x="200" y="78" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="price_di" bpmnElement="price"><dc:Bounds x="350" y="78" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="approve_di" bpmnElement="approve"><dc:Bounds x="500" y="78" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="ship_di" bpmnElement="ship"><dc:Bounds x="650" y="78" width="100" height="80"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const EXTENSIONS = JSON.stringify({
  id: 'process-orders',
  extensions: {
    orders: {
      properties: { a: { id: 'a', name: 'amount', type: 'integer' }, r: { id: 'r', name: 'risk', type: 'string' } },
      mappings: {
        decide: { inputs: { amount: { type: 'VARIABLE', value: 'amount' } }, outputs: { risk: { type: 'VARIABLE', value: 'riskClass' } } },
        ship: { mappingType: 'MAP_ALL' },
      },
      constants: { decide: { _activiti_dmn_table_: { value: 'risk-decision' } } },
    },
  },
});

const CATALOG: Partial<ProjectCatalogData> = {
  dmn: [{ path: 'processes/risk.dmn', baseName: 'risk', decisions: [{ id: 'risk-decision', name: 'Risk', inputs: ['amount'], complexInputs: [], outputs: [{ name: 'riskClass', type: 'string' }] }] }],
};

let container: HTMLElement | undefined;
let modeler: BpmnModeler | undefined;

async function open(catalog: Partial<ProjectCatalogData> | null = CATALOG): Promise<BpmnModeler> {
  container = document.createElement('div');
  document.body.appendChild(container);
  modeler = new BpmnModeler({ container, moddleExtensions: { ...activitiModdleExtensions }, additionalModules: [ActivitiModule, ActivitiVariablesModule] } as never);
  if (catalog) modeler.get<ProjectCatalog>('projectCatalog').set(catalog);
  await importProcess(modeler as never, { xml: XML, extensionsJson: EXTENSIONS, name: 'orders' });
  return modeler;
}

afterEach(() => {
  modeler?.destroy();
  container?.remove();
  modeler = undefined;
});

const byName = (rows: Awaited<ReturnType<typeof readRows>>, name: string, local?: string) => rows.find((r) => r.variable.name === name && ((r.variable.scope as { id?: string } | undefined)?.id === local || (local === undefined && (r.variable.scope as { id?: string } | undefined)?.id === 'orders')));
const ids = (uses: Array<{ element: { id?: string } }>): string[] => uses.map((u) => u.element.id as string).sort();

describe('U14 Activiti variable resolver', () => {
  it('is the variableResolver service of @bpmn-io/variable-resolver, with the variables of the process', async () => {
    const m = await open();
    const all = await m.get<{ getVariables(): Promise<Record<string, ActivitiVariable[]>> }>('variableResolver').getVariables();
    expect(Object.keys(all)).toContain('orders');
    expect(all['orders']!.map((v) => v.name)).toEqual(expect.arrayContaining(['amount', 'risk', 'total', 'starter', 'shippingLabel', 'manager', 'approver']));
  });

  it('lists process variables, DMN outputs, mapping inputs, call activity parameters and the element variable of a loop', async () => {
    const m = await open();
    const rows = await readRows(m as never);
    const names = rows.map((r) => `${r.variable.name}${(r.variable.scope as { id?: string }).id === 'orders' ? '' : `@${(r.variable.scope as { id?: string }).id}`}`);
    expect(names).toEqual(expect.arrayContaining(['amount', 'risk', 'total', 'starter', 'shippingLabel', 'approver@approve', 'amount@decide']));

    // the extensions property: declared, typed, written by the process and by nobody else; read by the script, the mapping input
    const amount = byName(rows, 'amount')!.variable;
    expect(amount).toMatchObject({ declared: true, valueType: 'integer', external: false });
    expect(ids(amount.uses.readers)).toEqual(['decide', 'price']);

    // the decision output reaches `risk` through the output mapping, typed by the DMN column
    const risk = byName(rows, 'risk')!.variable;
    expect(risk.uses.writers.map((w) => w.kind).sort()).toEqual(['decision-output', 'declared']);
    expect(risk.uses.writers.find((w) => w.kind === 'decision-output')!.detail).toContain('output "riskClass" of decision Risk');

    // a call activity's out parameter, a script result and the initiator
    expect(ids(byName(rows, 'shippingLabel')!.variable.uses.writers)).toEqual(['ship']);
    expect(ids(byName(rows, 'total')!.variable.uses.writers)).toEqual(['price']);
    expect(ids(byName(rows, 'total')!.variable.uses.readers)).toEqual(['ship']);
    expect(ids(byName(rows, 'starter')!.variable.uses.writers)).toEqual(['start']);

    // the multi-instance element variable is local to its task and read by the assignee... which here reads `manager`
    const approver = byName(rows, 'approver', 'approve')!;
    expect(approver.scopeLabel).toBe('local to Approve');
    expect(ids(approver.variable.uses.writers)).toEqual(['approve']);
    // read, written nowhere: comes with the start or from the caller
    expect(byName(rows, 'manager')!.variable.external).toBe(true);
    expect(byName(rows, 'approvers')!.variable.external).toBe(true);
  });

  it('follows the diagram, the extensions file and the project: the cache is invalidated by each', async () => {
    const m = await open(null);
    let rows = await readRows(m as never);
    // without the DMN file in the project the decision is unknown: the output is an ordinary output mapping
    expect(byName(rows, 'risk')!.variable.uses.writers.map((w) => w.kind).sort()).toEqual(['declared', 'output-mapping']);
    m.get<ProjectCatalog>('projectCatalog').set(CATALOG);
    rows = await readRows(m as never);
    expect(byName(rows, 'risk')!.variable.valueType).toBe('string');

    new DiagramBuilder(m as never).setProperty('price', 'script.resultVariable', 'grandTotal');
    rows = await readRows(m as never);
    expect(byName(rows, 'grandTotal')).toBeTruthy();
    expect(byName(rows, 'total')!.variable.uses.writers).toEqual([]);

    m.get<ExtensionsStore>('extensionsStore').update('add a variable', (file) => {
      file.extensions['orders']!.properties['n'] = { id: 'n', name: 'newlyDeclared', type: 'string' };
    });
    expect(byName(await readRows(m as never), 'newlyDeclared')).toBeTruthy();
  });

  it('answers the scope queries of the package: what the selected element reads or writes', async () => {
    const m = await open();
    const resolver = m.get<{ getVariablesForElement(el: unknown, o?: object): Promise<ActivitiVariable[]> }>('variableResolver');
    const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
    const forPrice = await resolver.getVariablesForElement(registry.get('price'), { read: true, written: true });
    expect(forPrice.map((v) => v.name)).toEqual(expect.arrayContaining(['amount', 'total']));
  });

  it('highlights the writers and readers of a variable on the canvas, and takes the markers away again', async () => {
    const m = await open();
    const total = byName(await readRows(m as never), 'total')!.variable;
    const canvas = m.get<{ hasMarker(el: unknown, marker: string): boolean }>('canvas');
    const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
    const off = highlight(m as never, total);
    expect(canvas.hasMarker(registry.get('price'), WRITER_MARKER)).toBe(true);
    expect(canvas.hasMarker(registry.get('ship'), READER_MARKER)).toBe(true);
    expect(canvas.hasMarker(registry.get('price'), READER_MARKER)).toBe(false);
    off();
    expect(canvas.hasMarker(registry.get('price'), WRITER_MARKER)).toBe(false);
    expect(canvas.hasMarker(registry.get('ship'), READER_MARKER)).toBe(false);
  });

  it('keeps the JUEL completions of the properties panel: the variables of the diagram are still suggested', async () => {
    const m = await open();
    const { variableSuggestions } = await import('@activiti-modeler/bpmn-js-activiti');
    const names = variableSuggestions(m.get('elementRegistry') as never, m.get('extensionsStore') as never, (m.get('elementRegistry') as { get(id: string): never }).get('approve')).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['amount', 'risk', 'total', 'starter', 'shippingLabel', 'approver']));
  });
});
