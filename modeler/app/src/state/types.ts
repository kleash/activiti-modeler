import type { ComponentType } from 'react';

import type { LossReport, ProjectFileData, ProjectWorkspace, RecentProject, ProjectRecord } from '@activiti-modeler/activiti-project';

import type { LayoutState } from './layout';
import type { Settings } from './settings';

/** How a BPMN tab shows its file: the diagram, the XML source or the extensions JSON. */
export type BpmnView = 'diagram' | 'xml' | 'json';

export interface TabState {
  id: string;
  /** Path of the file the tab edits (for a process: the BPMN file; its extensions file is edited with it). */
  path: string;
  /** Id of the editor (see editorRegistry.ts). */
  editor: string;
  view: BpmnView;
  title: string;
  dirty: boolean;
  /** Import / export warnings of this file (shown in the bottom panel). */
  warnings: string[];
  /** Set when the editor could not open the file: the tab then shows the fail-safe error view. */
  error?: { message: string; detail?: string; /** Files to offer to open as plain text so that the problem can be fixed by hand. */ textFiles: string[] };
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  detail?: string;
}

export type DialogState =
  | { id: number; kind: 'prompt'; title: string; label: string; initial: string; confirmLabel: string; hint?: string; validate?: (value: string) => string | undefined }
  | { id: number; kind: 'choice'; title: string; message: string; detail?: string; choices: Array<{ id: string; label: string; primary?: boolean; danger?: boolean }> }
  | { id: number; kind: 'alert'; title: string; message: string; detail?: string }
  | { id: number; kind: 'shortcuts' }
  | { id: number; kind: 'settings' }
  | { id: number; kind: 'projects' }
  | { id: number; kind: 'templates' }
  | { id: number; kind: 'lossReport'; path: string; report: LossReport }
  /** After File > Export project as zip: what an application that runs the files needs; `connectors` and `dmn` say what the project has. */
  | { id: number; kind: 'exportInfo'; connectors: boolean; dmn: boolean };

export interface AppSnapshot {
  ready: boolean;
  startupError?: string;
  /** Present once a project is open. */
  project?: {
    name: string;
    key: string;
    label: string;
    kind: string;
    paths: string[];
    /** Files with unsaved changes: working copies and files of dirty tabs. */
    dirtyPaths: ReadonlySet<string>;
  };
  tabs: TabState[];
  activeTabId?: string;
  layout: LayoutState;
  settings: Settings;
  toasts: Toast[];
  dialog?: DialogState;
  projects: ProjectRecord[];
  recent: RecentProject[];
  dropActive: boolean;
  closedCount: number;
  /** Paths of the files that were converted from Camunda 7 in this session: their report can be shown again. */
  lossReportPaths: readonly string[];
  folderSupported: boolean;
  /** Bumps with every change; lets components memoize on it. */
  revision: number;
}

export interface EditorHandle {
  /** The files to write for a Save, named after `targetPath` (which differs from the tab's path for Save As). */
  serialize(targetPath: string): Promise<ProjectFileData[]>;
  /** Runs before a save, e.g. applies the XML source to the diagram; throw to abort the save. */
  beforeSave?(): Promise<void>;
  /** Called after the files were written. `path` is the (possibly new) path of the tab's file. */
  markSaved?(path: string): void;
  /** Runs a command id (undo, zoomFit, handTool, ...). */
  perform?(action: string): Promise<void> | void;
  focus?(): void;
  selectionCount?(): number;
  /** The settings changed: an editor applies the ones it uses at once. */
  settingsChanged?(settings: Settings): void;
  /** Image export of the diagram. */
  exportImage?(format: 'svg' | 'png'): Promise<Blob>;
}

export interface EditorHost {
  readonly workspace: ProjectWorkspace;
  readonly isMac: boolean;
  setHandle(handle: EditorHandle | undefined): void;
  setDirty(dirty: boolean): void;
  setWarnings(warnings: string[]): void;
  /** The editor cannot open the file: the tab switches to the fail-safe error view. */
  fail(message: string, detail?: string, textFiles?: string[]): void;
  /** Reopens this tab's file with another editor (e.g. the diagram after fixing the source as text). */
  openWith(editorId: string): void;
  setView(view: BpmnView): void;
  toast(message: string, kind?: Toast['kind'], detail?: string): void;
  layout(): LayoutState;
  setLayout(patch: Partial<LayoutState>, persist?: boolean): void;
  /** The settings of the app (feature U19). */
  settings(): Settings;
  /** Shows the report of a Camunda 7 conversion of this tab's file (and keeps it for the menu). */
  showLossReport(report: LossReport): void;
  /** Saves this tab (the same as the Save command). */
  requestSave(): Promise<void>;
  /** Draft autosave and dirty bookkeeping use these. */
  paths(): ReadonlySet<string>;
}

export interface EditorProps {
  tab: TabState;
  host: EditorHost;
  /** True for the visible tab. Editors stay mounted while hidden, to keep their undo history. */
  active: boolean;
}

export interface EditorDescriptor {
  id: string;
  label: string;
  /** A priority when the editor can open the path, `false` when it cannot. The highest wins. */
  accepts(path: string): number | false;
  Component: ComponentType<EditorProps>;
}
