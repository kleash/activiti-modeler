import alignToOrigin from '@bpmn-io/align-to-origin';
import elementTemplateChooser from '@bpmn-io/element-template-chooser';
import { activitiModdleExtensions, ActivitiModule, type ExportableModeler, type ImportableModeler } from '@activiti-modeler/bpmn-js-activiti';
import { ActivitiLintModule } from '@activiti-modeler/bpmnlint-plugin-activiti/editor';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import { CopyAsImageModule } from 'bpmn-js-copy-as-image';
import colorPickerModule from 'bpmn-js-color-picker';
import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything';
import { ActivitiPropertiesModule, propertiesPanelConfig, storePanelLayout } from '../properties';
import { ActivitiVariablesModule } from '../variables/ActivitiVariableResolver';
import { PngViaDataUrlModule } from './pngImage';
import nativeCopyPaste from 'bpmn-js-native-copy-paste';
import gridModule from 'diagram-js-grid';
import minimapModule from 'diagram-js-minimap';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import 'diagram-js-minimap/assets/diagram-js-minimap.css';
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css';
import '@bpmn-io/element-template-chooser/dist/element-template-chooser.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';

/** What the shell uses of a bpmn-js modeler besides export / import. */
export interface ModelerLike extends ExportableModeler, ImportableModeler {
  saveSVG(): Promise<{ svg: string }>;
  destroy(): void;
}

/** The mounting of the properties panel: the shell attaches it to its slot while the tab is visible. */
export interface PropertiesPanelHost {
  attachTo(container: HTMLElement): void;
  detach(): void;
}

interface EventBus {
  on(event: string, callback: (event: never) => void): void;
  off(event: string, callback: (event: never) => void): void;
}

/**
 * The clipboard of bpmn-js keeps the copied elements per modeler. This one lives for the whole page, so that copy in one tab
 * and paste in another works even when the system clipboard is not available (see the native copy / paste module, which
 * normally carries the elements through the system clipboard).
 */
let sharedClipboard: unknown;
let systemClipboardRefused = false;
class SharedClipboard {
  get(): unknown {
    return sharedClipboard;
  }
  set(data: unknown): void {
    sharedClipboard = data;
  }
  clear(): unknown {
    const data = sharedClipboard;
    sharedClipboard = undefined;
    return data;
  }
  isEmpty(): boolean {
    return !sharedClipboard;
  }
}
const SharedClipboardModule = { clipboard: ['type', SharedClipboard] };

/** Copies the elements into the page clipboard before the native module (priority 2050) takes over. */
class KeepLocalCopy {
  static $inject = ['eventBus', 'clipboard'];
  constructor(eventBus: { on(event: string, priority: number, cb: (context: { tree?: unknown }) => void): void }, clipboard: SharedClipboard) {
    eventBus.on('copyPaste.elementsCopied', 3000, (context) => {
      if (context.tree) clipboard.set(context.tree);
    });
  }
}
const KeepLocalCopyModule = { __init__: ['keepLocalCopy'], keepLocalCopy: ['type', KeepLocalCopy] };

export interface CreateModelerOptions {
  container: HTMLElement;
  minimapOpen: boolean;
  gridVisible: boolean;
  /** The setting for new user tasks, call activities and catch events (ADR 0006). */
  defaultMappings?: 'mapAll' | 'none';
  /** Called when the system clipboard cannot be used (permission denied, not a secure context). */
  onClipboardUnavailable?: (message: string) => void;
}

/** A bpmn-js modeler with the Activiti modules and the editor features of the shell (feature rows U4, U6, U8, U13). */
export function createModeler(options: CreateModelerOptions): ModelerLike {
  const modeler = new BpmnModeler({
    container: options.container,
    moddleExtensions: { ...activitiModdleExtensions },
    additionalModules: [ActivitiModule, ActivitiLintModule, ActivitiPropertiesModule, elementTemplateChooser, minimapModule, gridModule, alignToOrigin, SharedClipboardModule, nativeCopyPaste, KeepLocalCopyModule, CopyAsImageModule, PngViaDataUrlModule, CreateAppendAnythingModule, colorPickerModule, ActivitiVariablesModule],
    minimap: { open: options.minimapOpen },
    // the canvas markers of the lint (feature U11); the Problems panel lists the same problems
    linting: { active: true },
    activitiExtensions: { defaultMappings: options.defaultMappings ?? 'mapAll' },
    // the groups of the properties panel the user left open; a typed value is written after a short pause (or when the field loses the focus)
    propertiesPanel: propertiesPanelConfig(),
    debounceInput: 400,
    // aligning is a command (Cmd+Shift+O) that moves the content to the origin; saving moves the exported copy, see exportProcess
    alignToOrigin: { alignOnSave: false, offset: { x: 0, y: 0 }, tolerance: 0 },
  } as never) as unknown as ModelerLike;

  const eventBus = modeler.get<EventBus>('eventBus');
  eventBus.on('propertiesPanel.layoutChanged', ((event: { layout: unknown }) => storePanelLayout(event.layout)) as never);
  const native = modeler.get<{ toggle(active: boolean): void }>('nativeCopyPaste');
  const copyPaste = modeler.get<{ paste(): void }>('copyPaste');
  // once the system clipboard has been refused, no modeler of this page tries it again
  if (systemClipboardRefused) native.toggle(false);
  eventBus.on('native-copy-paste:error', ((event: { message: string; error: unknown }) => {
    // fall back to the clipboard of this page; copy and paste then work between the tabs of the app
    native.toggle(false);
    if (!systemClipboardRefused) {
      systemClipboardRefused = true;
      options.onClipboardUnavailable?.(`System clipboard not available (${event.message}); copy and paste work between the tabs of this page only.`);
    }
    // the paste that just failed is done again with the page clipboard
    if (event.message.startsWith('failed to paste')) copyPaste.paste();
  }) as never);

  if (!options.gridVisible) modeler.get<{ setActive(active: boolean): void }>('gridSnapping').setActive(false);
  return modeler;
}
