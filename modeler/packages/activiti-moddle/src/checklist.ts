import checklistJson from '../support/activiti-attributes.json';

/** One attribute or child element that the Activiti 9.0.0 BPMN converter reads (see scripts/generate-attributes.mjs). */
export interface ChecklistEntry {
  /** `userTask@activiti:assignee` (attribute) or `serviceTask>activiti:field` (child element). */
  id: string;
  /** XML local name of the element that carries the attribute, or that contains the child element. */
  element: string;
  kind: 'attribute' | 'element';
  /** `activiti` / `bpmn` namespace, or `none` for the unqualified attributes of activiti: child elements. */
  namespace: 'activiti' | 'bpmn' | 'none';
  name: string;
  /** strict = only activiti: counts, agnostic = any namespace or none, local-name = child matched by local name. */
  match: 'strict' | 'agnostic' | 'local-name';
  origin: string[];
  /** `edit` = the modeler offers it, `roundtrip` = preserved on import and export only. */
  modeler: 'edit' | 'roundtrip';
  body?: 'text' | 'attributes' | 'children';
  note?: string;
}

export interface Checklist {
  source: string;
  namespace: string;
  counts: { total: number; attributes: number; elements: number };
  entries: ChecklistEntry[];
}

/** Every Activiti 9.0.0 attribute and child element the converter reads, generated from the engine sources. */
export const ACTIVITI_CHECKLIST = checklistJson as unknown as Checklist;
