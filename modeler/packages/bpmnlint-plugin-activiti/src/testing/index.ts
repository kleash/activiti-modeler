/** Helpers for the rule fixtures: build a document from a fixture, lint it with one rule or a whole config. */
import { createModdle } from '../parse';
import { RULES_BY_ID } from '../catalog';
import { lintRaw, onlyRule, toProblems } from '../linter';
import { duplicateIdsFromWarnings, unresolvedFromWarnings } from '../context';
import type { Fixture, LintContext, Problem } from '../types';

export const NAMESPACES =
  'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ' +
  'xmlns:activiti="http://activiti.org/bpmn" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"';

/** The XML of a fixture: `<definitions id="d">` (head) `<process id="p">` (body) `</process>` (tail). */
export function fixtureXml(fixture: Fixture): string {
  if (fixture.xml) return fixture.xml;
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions ${NAMESPACES} id="d"${fixture.defs?.includes('targetNamespace') ? '' : ' targetNamespace="urn:fixture"'}${fixture.defs ? ` ${fixture.defs}` : ''}>
${fixture.head ?? ''}
  <process id="p" ${fixture.process ?? 'isExecutable="true"'}>
${fixture.body ?? ''}
  </process>
${fixture.tail ?? ''}
</definitions>
`;
}

/** The process extensions of a fixture as a file. */
export function fixtureExtensions(fixture: Fixture): import('@activiti-modeler/activiti-project').ExtensionsFile | undefined {
  if (!fixture.ext) return undefined;
  if ('extensions' in fixture.ext) return fixture.ext as never;
  return { id: 'fixture', extensions: { p: { properties: {}, mappings: {}, constants: {}, ...fixture.ext } } } as never;
}

export async function lintFixture(ruleId: string, fixture: Fixture, level: 'error' | 'warn' | 'info' = 'error'): Promise<Problem[]> {
  const rule = ruleId.includes('/') ? ruleId : `activiti/${ruleId}`;
  const { problems } = await lintFixtureWith(onlyRule(rule, level), fixture);
  return problems;
}

export async function lintFixtureWith(config: Parameters<typeof lintRaw>[1] extends infer O ? (O extends { config?: infer C } ? C : never) : never, fixture: Fixture): Promise<{ problems: Problem[]; warnings: string[] }> {
  const { fixtureProjectIndex } = await import('../project');
  const result = await createModdle().fromXML(fixtureXml(fixture));
  const extensions = fixtureExtensions(fixture);
  const project = fixture.files
    ? await fixtureProjectIndex({ ...fixture.files, 'p.bpmn20.xml': fixtureXml(fixture), ...(extensions ? { 'p-extensions.json': JSON.stringify(extensions) } : {}) })
    : undefined;
  const context: LintContext = {
    path: 'p.bpmn20.xml',
    unresolved: unresolvedFromWarnings(result.warnings),
    duplicateIds: duplicateIdsFromWarnings(result.warnings),
    ...(extensions ? { extensions } : {}),
    ...(project ? { project } : {}),
    text: fixtureXml(fixture),
    ...(fixture.context ?? {}),
  };
  const raw = await lintRaw(result.rootElement, { context, config: config as never });
  return { problems: toProblems(raw, 'p.bpmn20.xml'), warnings: result.warnings.map((w) => w.message) };
}

export { RULES_BY_ID };
