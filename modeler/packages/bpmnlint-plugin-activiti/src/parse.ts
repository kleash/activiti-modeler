import { activitiModdleDescriptor } from '@activiti-modeler/activiti-moddle';
import { BpmnModdle } from 'bpmn-moddle';

import { duplicateIdsFromWarnings, unresolvedFromWarnings } from './context';
import type { ME } from './types';

/** A bpmn-moddle with the Activiti descriptor and no Camunda or Zeebe one: their attributes stay in `$attrs`, where L1 finds them. */
export function createModdle(): BpmnModdle {
  return new BpmnModdle({ activiti: activitiModdleDescriptor as never });
}

export interface ParsedBpmn {
  definitions: ME;
  warnings: Array<{ message: string }>;
  unresolved: Map<object, Record<string, string>>;
  duplicateIds: Array<{ id: string; tag: string }>;
}

/** Parses a BPMN document. Throws with the parser's message when the XML cannot be read at all. */
export async function parseBpmn(xml: string): Promise<ParsedBpmn> {
  const result = await createModdle().fromXML(xml);
  return {
    definitions: result.rootElement,
    warnings: result.warnings.map((w) => ({ message: w.message })),
    unresolved: unresolvedFromWarnings(result.warnings),
    duplicateIds: duplicateIdsFromWarnings(result.warnings),
  };
}
