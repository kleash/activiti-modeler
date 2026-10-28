import type { ModelerLike } from './modeler';
import { svgToPngBlob } from './pngImage';

interface EditorActions {
  trigger(action: string, options?: unknown): unknown;
  isRegistered(action: string): boolean;
}

/** Editor actions of bpmn-js that the menus and shortcuts trigger by the command id. */
const EDITOR_ACTIONS: Record<string, [string, unknown?]> = {
  undo: ['undo'],
  redo: ['redo'],
  copy: ['copy'],
  cut: ['cut'],
  paste: ['paste'],
  duplicate: ['duplicate'],
  selectAll: ['selectElements'],
  removeSelection: ['removeSelection'],
  find: ['find'],
  handTool: ['handTool'],
  lassoTool: ['lassoTool'],
  spaceTool: ['spaceTool'],
  globalConnectTool: ['globalConnectTool'],
  directEditing: ['directEditing'],
  replaceElement: ['replaceElement'],
  createElement: ['createElement'],
  appendElement: ['appendElement'],
  zoomIn: ['stepZoom', { value: 1 }],
  zoomOut: ['stepZoom', { value: -1 }],
  zoomActual: ['zoom', { value: 1 }],
  alignLeft: ['alignElements', { type: 'left' }],
  alignCenter: ['alignElements', { type: 'center' }],
  alignRight: ['alignElements', { type: 'right' }],
  alignTop: ['alignElements', { type: 'top' }],
  alignMiddle: ['alignElements', { type: 'middle' }],
  alignBottom: ['alignElements', { type: 'bottom' }],
  distributeHorizontally: ['distributeElements', { type: 'horizontal' }],
  distributeVertically: ['distributeElements', { type: 'vertical' }],
  copyAsImage: ['copySelectionAsImage'],
};

export const BPMN_ACTION_IDS: readonly string[] = [...Object.keys(EDITOR_ACTIONS), 'zoomFit', 'moveToOrigin', 'toggleMinimap', 'toggleGrid'];

export interface ActionContext {
  /** Called with the new state after the minimap or the grid was toggled (to persist the layout). */
  onLayout?: (patch: { minimapOpen?: boolean; gridVisible?: boolean }) => void;
}

/** Runs a command id on a modeler. Unknown ids are ignored (they belong to the shell). */
export async function performBpmnAction(modeler: ModelerLike, action: string, context: ActionContext = {}): Promise<void> {
  const editorActions = modeler.get<EditorActions>('editorActions');
  switch (action) {
    case 'zoomFit':
      modeler.get<{ zoom(level: string, center?: string): void }>('canvas').zoom('fit-viewport', 'auto');
      return;
    case 'moveToOrigin':
      modeler.get<{ align(): void }>('alignToOrigin').align();
      return;
    case 'toggleMinimap': {
      const minimap = modeler.get<{ toggle(): void; isOpen(): boolean }>('minimap');
      minimap.toggle();
      context.onLayout?.({ minimapOpen: minimap.isOpen() });
      return;
    }
    case 'toggleGrid': {
      const snapping = modeler.get<{ isActive(): boolean; setActive(active: boolean): void }>('gridSnapping');
      snapping.setActive(!snapping.isActive());
      context.onLayout?.({ gridVisible: snapping.isActive() });
      return;
    }
    default: {
      const entry = EDITOR_ACTIONS[action];
      if (entry && editorActions.isRegistered(entry[0])) await editorActions.trigger(entry[0], entry[1]);
    }
  }
}

export function selectionCount(modeler: ModelerLike): number {
  return modeler.get<{ get(): unknown[] }>('selection').get().length;
}

/** The diagram as SVG text or PNG (via canvas), for the export commands. */
export async function exportDiagramImage(modeler: ModelerLike, format: 'svg' | 'png'): Promise<Blob> {
  const { svg } = await modeler.saveSVG();
  if (format === 'svg') return new Blob([svg], { type: 'image/svg+xml' });
  return svgToPngBlob(svg);
}
