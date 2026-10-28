// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createLintModeler, documentWith, type LintModeler } from './test-modeler';
import type { Problem } from '../types';

let current: LintModeler | undefined;
afterEach(() => {
  current?.destroy();
  current = undefined;
});

const open = async (body: string, shapes: Array<{ id: string; x: number; y: number; w?: number; h?: number }>, extensionsJson?: string, defs = ''): Promise<LintModeler> => {
  current = await createLintModeler(documentWith(body, shapes, defs), extensionsJson);
  return current;
};

const json = (entry: Record<string, unknown>): string => JSON.stringify({ id: 'x', extensions: { p: { properties: {}, mappings: {}, constants: {}, ...entry } } });
const pick = (problems: Problem[], rule: string, elementId?: string): Problem => {
  const p = problems.find((x) => x.rule === rule && (elementId === undefined || x.elementId === elementId));
  if (!p) throw new Error(`no ${rule} problem; got ${problems.map((x) => `${x.rule}@${x.elementId}`).join(', ')}`);
  return p;
};
const rules = (problems: Problem[]): string[] => problems.map((p) => p.rule);

/** Applies the fix, checks that the rule is quiet afterwards, that the model exports and that one undo brings the problem back. */
async function fixAndVerify(m: LintModeler, rule: string, elementId?: string): Promise<{ before: Problem[]; after: Problem[]; xml: string }> {
  const before = await m.lint();
  const problem = pick(before, rule, elementId);
  const result = m.linting.applyFix(problem);
  expect(result).toEqual({ ok: true });
  const after = await m.lint();
  expect(after.filter((p) => p.rule === rule)).toHaveLength(before.filter((p) => p.rule === rule).length - 1);
  const xml = await m.exportXml();
  m.get<{ undo(): void }>('commandStack').undo();
  expect((await m.lint()).filter((p) => p.rule === rule)).toHaveLength(before.filter((p) => p.rule === rule).length);
  m.get<{ redo(): void }>('commandStack').redo();
  return { before, after, xml };
}

describe('quick fixes', () => {
  it('converts a business rule task to a decision task', async () => {
    const m = await open('<businessRuleTask id="b" name="Decide" camunda:decisionRef="grade"/>', [{ id: 'b', x: 100, y: 100 }]);
    const { xml } = await fixAndVerify(m, 'activiti/no-business-rule-task');
    expect(xml).toContain('implementation="dmn-connector.EXECUTE_TABLE"');
    expect(xml).not.toContain('businessRuleTask');
  });

  it('replaces a complex gateway by an exclusive gateway', async () => {
    const m = await open('<complexGateway id="g"/>', [{ id: 'g', x: 100, y: 100, w: 50, h: 50 }]);
    const { xml } = await fixAndVerify(m, 'bpmnlint/no-complex-gateway');
    expect(xml).toContain('exclusiveGateway');
    expect(xml).not.toContain('complexGateway');
  });

  it('turns a signal end event into a throw signal and a none end', async () => {
    const m = await open(
      '<startEvent id="s"/><endEvent id="e"><signalEventDefinition signalRef="sig"/></endEvent><sequenceFlow id="f" sourceRef="s" targetRef="e"/>',
      [{ id: 's', x: 100, y: 100, w: 36, h: 36 }, { id: 'e', x: 300, y: 100, w: 36, h: 36 }],
      undefined,
      '<signal id="sig" name="go"/>',
    );
    const { xml } = await fixAndVerify(m, 'activiti/no-signal-end-event');
    expect(xml).toMatch(/<(bpmn:)?intermediateThrowEvent[\s\S]*signalEventDefinition[\s\S]*signalRef="sig"/);
    expect(xml).toMatch(/<(bpmn:)?endEvent/);
    expect(xml).not.toMatch(/<(bpmn:)?endEvent[^>]*>\s*<(bpmn:)?signalEventDefinition/);
  });

  it('adds a MAP_ALL mapping', async () => {
    const m = await open('<userTask id="u" name="Review"/>', [{ id: 'u', x: 100, y: 100 }], json({}));
    await fixAndVerify(m, 'activiti/missing-mapping');
    expect(m.get<{ getProcess(p: string): { mappings: Record<string, { mappingType?: string }> } }>('extensionsStore').getProcess('p').mappings['u']?.mappingType).toBe('MAP_ALL');
  });

  it('declares an undeclared output target', async () => {
    const m = await open('<serviceTask id="s" name="x" implementation="crm.LOOKUP"/>', [{ id: 's', x: 100, y: 100 }], json({ mappings: { s: { outputs: { tier: { type: 'VARIABLE', value: 'tier' } } } } }));
    await fixAndVerify(m, 'activiti/output-target-undeclared');
    const props = Object.values(m.get<{ getProcess(p: string): { properties: Record<string, { name: string }> } }>('extensionsStore').getProcess('p').properties);
    expect(props.map((p) => p.name)).toContain('tier');
  });

  it('removes a mapping that belongs to an element that is gone', async () => {
    const m = await open('<task id="t"/>', [{ id: 't', x: 100, y: 100 }], json({ mappings: { gone: { mappingType: 'MAP_ALL' } } }));
    await fixAndVerify(m, 'activiti/extensions-unknown-element');
    expect(Object.keys(m.get<{ getProcess(p: string): { mappings: object } }>('extensionsStore').getProcess('p').mappings)).toEqual([]);
  });

  it('removes a standard loop marker', async () => {
    const m = await open('<task id="t"><standardLoopCharacteristics/></task>', [{ id: 't', x: 100, y: 100 }]);
    const { xml } = await fixAndVerify(m, 'activiti/no-standard-loop');
    expect(xml).not.toContain('standardLoop');
  });

  it('deletes a group (a flow element of its own kind: category, shape and artifact go together)', async () => {
    const group = '<category id="cat"><categoryValue id="cv" value="Phase"/></category>';
    const m = await open('<task id="t"/><group id="g" categoryValueRef="cv"/>', [{ id: 't', x: 100, y: 100 }], undefined, group);
    const { before, after, xml } = await fixAndVerify(m, 'activiti/no-group', 'g');
    expect(rules(before)).toContain('activiti/no-group');
    expect(rules(after)).not.toContain('activiti/no-group');
    expect(xml).not.toContain('<group');
  });
});

describe('quick fixes for Camunda leftovers', () => {
  it('translates attributes, drops the unused namespace and leaves an exportable model', async () => {
    const m = await open(
      '<userTask id="u" name="Review" camunda:assignee="kermit" camunda:candidateGroups="g1" camunda:asyncBefore="true" camunda:followUpDate="${later}"/>',
      [{ id: 'u', x: 100, y: 100 }],
    );
    let problems = await m.lint();
    expect(problems.filter((p) => p.rule === 'activiti/no-camunda-extensions')).toHaveLength(4);
    for (let i = 0; i < 4; i += 1) {
      const next = pick(problems, 'activiti/no-camunda-extensions');
      expect(m.linting.applyFix(next)).toEqual({ ok: true });
      problems = await m.lint();
    }
    expect(problems.filter((p) => p.rule === 'activiti/no-camunda-extensions')).toEqual([]);
    const xml = await m.exportXml();
    expect(xml).toContain('activiti:assignee="kermit"');
    expect(xml).toContain('activiti:candidateGroups="g1"');
    expect(xml).toContain('activiti:async="true"');
    expect(xml).not.toContain('camunda');
  });

  it('translates listeners, fields and input / output parameters', async () => {
    const m = await open(
      `<serviceTask id="s" name="Call" camunda:class="a.B">
         <extensionElements>
           <camunda:executionListener event="start" class="a.L"><camunda:field name="f"><camunda:string>v</camunda:string></camunda:field></camunda:executionListener>
           <camunda:field name="to" stringValue="x"/>
           <camunda:inputOutput>
             <camunda:inputParameter name="amount">\${total}</camunda:inputParameter>
             <camunda:inputParameter name="channel">web</camunda:inputParameter>
             <camunda:outputParameter name="result">\${answer}</camunda:outputParameter>
           </camunda:inputOutput>
         </extensionElements>
       </serviceTask>`,
      [{ id: 's', x: 100, y: 100 }],
    );
    let problems = await m.lint();
    const count = problems.filter((p) => p.rule === 'activiti/no-camunda-extensions').length;
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i += 1) {
      const next = pick(problems, 'activiti/no-camunda-extensions');
      expect(m.linting.applyFix(next)).toEqual({ ok: true });
      problems = await m.lint();
    }
    expect(problems.filter((p) => p.rule === 'activiti/no-camunda-extensions')).toEqual([]);
    const xml = await m.exportXml();
    expect(xml).toContain('activiti:class="a.B"');
    expect(xml).toMatch(/activiti:executionListener[^>]*event="start"[^>]*class="a.L"|activiti:executionListener[^>]*class="a.L"[^>]*event="start"/);
    expect(xml).toContain('activiti:field');
    expect(xml).not.toContain('camunda');
    const mapping = m.get<{ getProcess(p: string): { mappings: Record<string, { inputs?: Record<string, { type: string; value: unknown }>; outputs?: Record<string, { type: string; value: unknown }> }> } }>('extensionsStore').getProcess('p').mappings['s'];
    expect(mapping?.inputs).toEqual({ amount: { type: 'VARIABLE', value: 'total' }, channel: { type: 'VALUE', value: 'web' } });
    expect(mapping?.outputs).toEqual({ result: { type: 'VARIABLE', value: 'answer' } });
  });

  it('removes a Zeebe element that has no equivalent', async () => {
    const m = await open('<serviceTask id="s" name="x" activiti:class="a.B"><extensionElements><zeebe:taskDefinition xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" type="x"/></extensionElements></serviceTask>', [{ id: 's', x: 100, y: 100 }]);
    const { xml } = await fixAndVerify(m, 'activiti/no-camunda-extensions');
    expect(xml).not.toContain('zeebe');
  });
});
