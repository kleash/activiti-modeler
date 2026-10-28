/** Quick fixes the Problems panel offers (the implementations are in editor/fixes.ts; a rule only names the fix). */
export const FIXES = {
  'convert-business-rule-task': 'Convert to a Decision task',
  'complex-to-exclusive': 'Replace by an exclusive gateway',
  'signal-end-to-throw': 'Throw the signal, then end with a none end event',
  'add-map-all': 'Add a MAP_ALL mapping',
  'translate-camunda': 'Translate to the Activiti equivalent',
  'remove-camunda': 'Remove (Activiti has no equivalent)',
  'set-executable': 'Make the process executable',
  'remove-element': 'Delete the element',
  'declare-output-target': 'Declare the variable in the process properties',
  'remove-mapping-key': 'Remove the entry',
  'remove-process-entry': 'Remove the entry of the unknown process',
  'remove-unsupported-loop': 'Remove the loop marker',
  'remove-attribute': 'Remove the attribute',
} as const;

export type FixId = keyof typeof FIXES;
export const fixLabel = (id: string): string => (FIXES as Record<string, string>)[id] ?? id;
