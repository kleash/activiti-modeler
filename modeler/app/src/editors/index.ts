import { classifyFile, editorKindOf } from '@activiti-modeler/activiti-project';

import { registerEditor } from '../state/editorRegistry';
import { BpmnTabEditor } from './BpmnEditor';
import { ConnectorTabEditor } from './ConnectorEditor';
import { DmnTabEditor } from './dmn/DmnEditor';
import { TextTabEditor } from './TextEditor';

let registered = false;

/**
 * The editors of the shell. Add an editor for a kind of file with `registerEditor` and a higher priority than the one here: the
 * DMN editor (dmn-js) takes `*.dmn` from the text editor `dmn-source` that way, which stays for files that are no DMN.
 */
export function registerBuiltinEditors(): void {
  if (registered) return;
  registered = true;
  registerEditor({ id: 'bpmn', label: 'diagram', accepts: (path) => (classifyFile(path) === 'bpmn' ? 10 : false), Component: BpmnTabEditor });
  registerEditor({ id: 'dmn', label: 'DMN', accepts: (path) => (classifyFile(path) === 'dmn' ? 10 : false), Component: DmnTabEditor });
  registerEditor({ id: 'dmn-source', label: 'DMN source', accepts: (path) => (classifyFile(path) === 'dmn' ? 1 : false), Component: TextTabEditor });
  registerEditor({ id: 'connector', label: 'connector', accepts: (path) => (classifyFile(path) === 'connector' ? 5 : false), Component: ConnectorTabEditor });
  registerEditor({ id: 'json', label: 'JSON', accepts: (path) => (editorKindOf(path) === 'json' ? 1 : false), Component: TextTabEditor });
  registerEditor({ id: 'text', label: 'text', accepts: () => 0, Component: TextTabEditor });
}
