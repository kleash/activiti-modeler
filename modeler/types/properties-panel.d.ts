// @bpmn-io/properties-panel and bpmn-js-properties-panel ship no declarations. Entries and groups are plain objects handed
// to the panel, so the loose shapes below cover what the Activiti provider uses.

declare module '@bpmn-io/properties-panel' {
  import type { ComponentType } from '@bpmn-io/properties-panel/preact';

  /** The props of an entry component are defined by the entry (`getValue`, `setValue`, `label`, ...). */
  type EntryComponent = ComponentType<Record<string, unknown>>;

  export const TextFieldEntry: EntryComponent;
  export const TextAreaEntry: EntryComponent;
  export const SelectEntry: EntryComponent;
  export const CheckboxEntry: EntryComponent;
  export const ToggleSwitchEntry: EntryComponent;
  export const NumberFieldEntry: EntryComponent;
  export const ListGroup: EntryComponent;
  export const Group: EntryComponent;
  export const CollapsibleEntry: EntryComponent;
  export const TooltipEntry: EntryComponent;
  export const DiagnosticMessage: EntryComponent;
  export const DescriptionEntry: EntryComponent;

  type Edited = (node: HTMLElement | null) => boolean;
  export const isTextFieldEntryEdited: Edited;
  export const isTextAreaEntryEdited: Edited;
  export const isSelectEntryEdited: Edited;
  export const isCheckboxEntryEdited: Edited;
  export const isToggleSwitchEntryEdited: Edited;
  export const isNumberFieldEntryEdited: Edited;

  export interface PanelDiagnostic {
    message: string;
    severity: 'error' | 'warning' | 'info';
  }

  /** Focuses the returned element when `propertiesPanel.showEntry` names this entry, and opens the groups around it. */
  export function useShowEntryEvent(id: string): { current: (HTMLElement & { select?: () => void }) | null };
  export function useDiagnostics(id: string): PanelDiagnostic[];
  export function useStaticCallback<T extends (...args: never[]) => unknown>(callback: T): T;
}

declare module 'bpmn-js-properties-panel' {
  /** The didi module of the panel host (the renderer that mounts the groups of the registered providers). */
  export const BpmnPropertiesPanelModule: { __depends__: unknown[]; __init__: string[]; [service: string]: unknown };
  export function useService<T = unknown>(name: string, strict?: boolean): T;
}

declare module '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
