import { activitiModdleDescriptor } from '@activiti-modeler/activiti-moddle';
import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';

import { extractOutline, type DecisionLike, type ModdleLike, type Outline, type OutlineVariable, type ProcessExtensionLike } from './extract';

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" id="d" targetNamespace="urn:t">`;

async function outlineOf(body: string, extension?: ProcessExtensionLike, decisions: DecisionLike[] = []): Promise<Outline> {
  const moddle = new BpmnModdle({ activiti: activitiModdleDescriptor as never });
  const { rootElement } = await moddle.fromXML(`${HEAD}<bpmn:process id="p" isExecutable="true">${body}</bpmn:process></bpmn:definitions>`);
  const root = (rootElement as unknown as { rootElements: ModdleLike[] }).rootElements.find((r) => r.$type === 'bpmn:Process')!;
  return extractOutline({ root, extension, decision: (ref) => decisions.find((d) => d.id === ref) });
}

const find = (outline: Outline, name: string, scope?: string): OutlineVariable | undefined => outline.variables.find((v) => v.name === name && v.scope?.id === scope);
const writers = (v: OutlineVariable | undefined): string[] => (v?.writers ?? []).map((w) => `${w.kind}@${w.element.id}`).sort();
const readers = (v: OutlineVariable | undefined): string[] => (v?.readers ?? []).map((r) => r.element.id as string).sort();

describe('U14 variable extraction', () => {
  it('declared process variables come from the extensions properties, with their type and the readers of expressions', async () => {
    const outline = await outlineOf(
      `<bpmn:userTask id="review" activiti:assignee="\${reviewer}" activiti:candidateGroups="\${groups}"/>
       <bpmn:sequenceFlow id="f" sourceRef="review" targetRef="review"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\${amount > limit}</bpmn:conditionExpression></bpmn:sequenceFlow>`,
      { properties: { a: { name: 'amount', type: 'integer' }, r: { name: 'reviewer', type: 'string' } } },
    );
    expect(find(outline, 'amount')).toMatchObject({ declared: true, type: 'integer', external: false });
    expect(writers(find(outline, 'amount'))).toEqual(['declared@p']);
    expect(readers(find(outline, 'amount'))).toEqual(['f']);
    expect(readers(find(outline, 'reviewer'))).toEqual(['review']);
    // read, declared nowhere and written nowhere: provided at the start, or by the caller
    expect(find(outline, 'limit')).toMatchObject({ declared: false, external: true });
    expect(find(outline, 'groups')).toMatchObject({ external: true });
  });

  it('result variables of script and service tasks, mail and shell outputs, the initiator and form properties are writers', async () => {
    const outline = await outlineOf(`
      <bpmn:startEvent id="start" activiti:initiator="starter"><bpmn:extensionElements><activiti:formProperty id="customer" name="Customer"/></bpmn:extensionElements></bpmn:startEvent>
      <bpmn:scriptTask id="calc" scriptFormat="juel" activiti:resultVariable="total"><bpmn:script>\${price * quantity}</bpmn:script></bpmn:scriptTask>
      <bpmn:serviceTask id="svc" activiti:expression="\${pricing.quote(order)}" activiti:resultVariableName="quote"/>
      <bpmn:serviceTask id="shell" activiti:type="shell"><bpmn:extensionElements>
        <activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field>
        <activiti:field name="outputVariable"><activiti:string>listing</activiti:string></activiti:field>
        <activiti:field name="errorCodeVariable" stringValue="exit"/>
      </bpmn:extensionElements></bpmn:serviceTask>`);
    expect(writers(find(outline, 'starter'))).toEqual(['initiator@start']);
    expect(writers(find(outline, 'customer'))).toEqual(['form@start']);
    expect(writers(find(outline, 'total'))).toEqual(['result@calc']);
    expect(writers(find(outline, 'quote'))).toEqual(['result@svc']);
    expect(writers(find(outline, 'listing'))).toEqual(['field@shell']);
    expect(writers(find(outline, 'exit'))).toEqual(['field@shell']);
    // the script reads price and quantity; the service expression reads order, and `pricing` is a bean, not a variable
    expect(readers(find(outline, 'price'))).toEqual(['calc']);
    expect(readers(find(outline, 'order'))).toEqual(['svc']);
    expect(find(outline, 'pricing')).toBeUndefined();
  });

  it('multi-instance: the element variable and the index are local to the activity, the collection is read, the output collection is written', async () => {
    const outline = await outlineOf(`
      <bpmn:userTask id="each" activiti:assignee="\${reviewer}">
        <bpmn:multiInstanceLoopCharacteristics isSequential="false" activiti:collection="reviewers" activiti:elementVariable="reviewer">
          <bpmn:loopDataOutputRef>verdicts</bpmn:loopDataOutputRef><bpmn:outputDataItem name="verdict"/>
          <bpmn:completionCondition>\${nrOfCompletedInstances >= quorum}</bpmn:completionCondition>
        </bpmn:multiInstanceLoopCharacteristics>
      </bpmn:userTask>
      <bpmn:userTask id="after" activiti:assignee="\${reviewer}"/>`);
    expect(find(outline, 'reviewer', 'each')).toMatchObject({ scope: { id: 'each' } });
    expect(writers(find(outline, 'reviewer', 'each'))).toEqual(['loop-element@each']);
    // the assignee of the loop activity reads the loop's variable; the task after the loop cannot
    expect(readers(find(outline, 'reviewer', 'each'))).toEqual(['each']);
    expect(find(outline, 'reviewer')).toMatchObject({ external: true });
    expect(readers(find(outline, 'reviewer'))).toEqual(['after']);
    expect(readers(find(outline, 'reviewers'))).toEqual(['each']);
    expect(writers(find(outline, 'verdicts'))).toEqual(['loop-output@each']);
    expect(writers(find(outline, 'verdict', 'each'))).toEqual(['loop-output@each']);
    expect(readers(find(outline, 'quorum'))).toEqual(['each']);
    // the loop counters are the engine's
    expect(find(outline, 'nrOfCompletedInstances')).toBeUndefined();
  });

  it('call activities: out targets are writers, in sources are readers', async () => {
    const outline = await outlineOf(`
      <bpmn:callActivity id="call" calledElement="child">
        <bpmn:extensionElements>
          <activiti:in source="customer" target="client"/>
          <activiti:in sourceExpression="\${order.total}" target="amount"/>
          <activiti:out source="status" target="approval"/>
          <activiti:out sourceExpression="\${result.ok}" target="ok"/>
        </bpmn:extensionElements>
      </bpmn:callActivity>`);
    expect(writers(find(outline, 'approval'))).toEqual(['call-out@call']);
    expect(writers(find(outline, 'ok'))).toEqual(['call-out@call']);
    expect(readers(find(outline, 'customer'))).toEqual(['call']);
    expect(readers(find(outline, 'order'))).toEqual(['call']);
    // the child's names (in targets, out sources) are not variables of this process
    expect(find(outline, 'client')).toBeUndefined();
    expect(find(outline, 'status')).toBeUndefined();
    expect(find(outline, 'result')).toBeUndefined();
  });

  it('mappings: inputs are local to the task and read the variable they take, outputs write process variables; constants are local', async () => {
    const outline = await outlineOf(
      `<bpmn:serviceTask id="mail" implementation="mailer.SEND"/><bpmn:userTask id="u"/>`,
      {
        properties: { s: { name: 'sent', type: 'boolean' } },
        mappings: {
          mail: {
            inputs: { to: { type: 'VARIABLE', value: 'customerEmail' }, subject: { type: 'VALUE', value: 'Order ${orderId}' }, body: { type: 'VALUE', value: 'plain' } },
            outputs: { sent: { type: 'VARIABLE', value: 'delivered' }, status: { type: 'VALUE', value: '${statusCode}' } },
          },
          u: { mappingType: 'MAP_ALL' },
        },
        constants: { mail: { sender: { value: 'noreply@example.com' } } },
      },
    );
    expect(find(outline, 'to', 'mail')).toBeTruthy();
    expect(writers(find(outline, 'to', 'mail'))).toEqual(['input-mapping@mail']);
    expect(writers(find(outline, 'sender', 'mail'))).toEqual(['constant@mail']);
    expect(readers(find(outline, 'customerEmail'))).toEqual(['mail']);
    // an input named like the variable it takes does not read itself
    expect(readers(find(outline, 'to', 'mail'))).toEqual([]);
    expect(readers(find(outline, 'orderId'))).toEqual(['mail']);
    expect(writers(find(outline, 'sent'))).toEqual(['declared@p', 'output-mapping@mail']);
    expect(find(outline, 'sent')?.type).toBe('boolean');
    expect(writers(find(outline, 'status'))).toEqual(['output-mapping@mail']);
    expect(readers(find(outline, 'statusCode'))).toEqual(['mail']);
    expect(outline.mapAll).toEqual([{ element: expect.objectContaining({ id: 'u' }), mappingType: 'MAP_ALL' }]);
  });

  it('a decision task writes the outputs of its decision to the targets of its output mapping, typed by the DMN output', async () => {
    const outline = await outlineOf(
      `<bpmn:serviceTask id="decide" name="Decide" implementation="dmn-connector.EXECUTE_TABLE"/>`,
      {
        mappings: { decide: { inputs: { age: { type: 'VARIABLE', value: 'applicantAge' } }, outputs: { risk: { type: 'VARIABLE', value: 'riskClass' }, cleared: { type: 'VARIABLE', value: 'matched' } } } },
        constants: { decide: { _activiti_dmn_table_: { value: 'risk' } } },
      },
      [{ id: 'risk', name: 'Risk', outputs: [{ name: 'riskClass', type: 'string' }] }],
    );
    const risk = find(outline, 'risk');
    expect(writers(risk)).toEqual(['decision-output@decide']);
    expect(risk?.type).toBe('string');
    expect(risk?.writers[0]!.detail).toContain('output "riskClass" of decision Risk');
    // the matched flag is no output column, but it is still written by the decision task
    expect(writers(find(outline, 'cleared'))).toEqual(['decision-output@decide']);
    expect(readers(find(outline, 'applicantAge'))).toEqual(['decide']);
    // the table constant is a reference, not a variable
    expect(find(outline, '_activiti_dmn_table_', 'decide')).toBeUndefined();
  });

  it('data objects and JavaScript scripts: getVariable reads, setVariable writes', async () => {
    const outline = await outlineOf(`
      <bpmn:dataObject id="do1" name="invoice" itemSubjectRef="xsd:string"/>
      <bpmn:scriptTask id="js" scriptFormat="javascript"><bpmn:script>var t = execution.getVariable('total'); execution.setVariable('vat', t * 0.2);</bpmn:script></bpmn:scriptTask>`);
    expect(writers(find(outline, 'invoice'))).toEqual(['data-object@do1']);
    expect(readers(find(outline, 'total'))).toEqual(['js']);
    expect(writers(find(outline, 'vat'))).toEqual(['script@js']);
  });

  it('a name in a label is not an expression, and an unknown element does not break the extraction', async () => {
    const outline = await outlineOf(`<bpmn:userTask id="u" name="Assignee from \${reviewer}"><bpmn:documentation>\${doc}</bpmn:documentation></bpmn:userTask>`);
    expect(outline.variables).toEqual([]);
  });

  it('sorts process variables first, then local ones, by name', async () => {
    const outline = await outlineOf(`<bpmn:userTask id="u" activiti:assignee="\${zed} \${alpha}"/>`, { mappings: { u: { inputs: { local: { type: 'VALUE', value: 1 } } } } });
    expect(outline.variables.map((v) => `${v.name}${v.scope ? '@' + v.scope.id : ''}`)).toEqual(['alpha', 'zed', 'local@u']);
  });
});
