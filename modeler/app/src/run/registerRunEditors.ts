import { classifyFile } from '@activiti-modeler/activiti-project';

import { registerEditor } from '../state/editorRegistry';
import { ScenarioTabEditor } from './ScenarioEditor';

let registered = false;

/**
 * The editors of the run features: the scenario editor for `*.scenario.json` (form, JSON, schema check, Run). It outranks the plain
 * JSON editor (priority 1) the shell registers.
 */
export function registerRunEditors(): void {
  if (registered) return;
  registered = true;
  registerEditor({ id: 'scenario', label: 'scenario', accepts: (path) => (classifyFile(path) === 'scenario' ? 20 : false), Component: ScenarioTabEditor });
}
