import {
  bpmnPathForExtensions, detectCamunda, lossReportMarkdown, type LossReport, classifyFile, connectorKeyOf, connectorSplitWarnings, createFromTemplate, normalizeConnectorFiles, readConnectorMeta, splitConnectorFile, writeConnectorMeta, defaultFolderFor, extensionsPathFor, FsAccessStorage, importZip, IndexedDbStorage, MemoryStorage,
  pathProblem, ProjectWorkspace, projectNameFromZip, ServerWorkspaceStorage, scanDecisionIds, scanProcessIds, splitName, uniquePath, exportZip, basename, dirname,
  joinPath, TEMPLATES, type ProjectFileData, type RecentProject, type StorageAdapter, type TemplateId,
} from '@activiti-modeler/activiti-project';

import { connection } from '../run/connection';
import { requestBottomTab } from './bottomTab';
import { downloadBlob } from './download';
import { editorFor } from './editorRegistry';
import { DEFAULT_LAYOUT, type LayoutState, loadLayout, saveLayout } from './layout';
import { availableLocales, setLocale, t } from '../i18n';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';
import { isMacPlatform } from './shortcuts';
import type { AppSnapshot, BpmnView, DialogState, EditorHandle, EditorHost, TabState, Toast } from './types';

interface TabInternal extends TabState {
  handle?: EditorHandle;
  host: EditorHost;
}

interface SessionRecord {
  tabs: Array<{ path: string; view: BpmnView }>;
  active?: string;
}

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const MAX_CLOSED = 20;
const DEFAULT_PROJECT = 'my-project';

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The part of a tab that components may read (no editor handle, no host). */
function tabState(tab: TabInternal): TabState {
  return { id: tab.id, path: tab.path, editor: tab.editor, view: tab.view, title: tab.title, dirty: tab.dirty, warnings: tab.warnings, ...(tab.error ? { error: tab.error } : {}) };
}

/** The file name of a process or DMN file without its suffix, for messages and the extensions JSON id. */
export const baseNameOf = (path: string): string => splitName(basename(path)).stem;

/**
 * The state and the commands of the app shell: the open project, the tabs, the dialogs and the layout. React reads it through
 * `subscribe` / `getSnapshot`; everything the menus, the keyboard and the explorer do goes through the methods here.
 */
export class AppController {
  readonly isMac = isMacPlatform();
  private readonly listeners = new Set<() => void>();
  private snap: AppSnapshot;
  private idb?: IndexedDbStorage;
  private ws?: ProjectWorkspace;
  private unsubscribeModel?: () => void;
  private tabs: TabInternal[] = [];
  private activeId?: string;
  private closed: string[] = [];
  private layout: LayoutState = loadLayout();
  private settings: Settings = loadSettings();
  private toasts: Toast[] = [];
  private dialog?: DialogState;
  private readonly resolvers = new Map<number, (value: unknown) => void>();
  private projects: AppSnapshot['projects'] = [];
  private recent: RecentProject[] = [];
  private dropActive = false;
  private startupError?: string;
  private ready = false;
  private nextId = 1;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  /** The report of the Camunda 7 conversion of each file converted in this session. */
  private readonly lossReports = new Map<string, LossReport>();

  constructor() {
    if (availableLocales().includes(this.settings.locale)) setLocale(this.settings.locale);
    this.snap = this.buildSnapshot();
  }

  // --- React binding --------------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppSnapshot => this.snap;

  private notify(): void {
    this.revision += 1;
    this.snap = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): AppSnapshot {
    const ws = this.ws;
    const dirtyPaths = new Set<string>(ws?.model.dirtyPaths() ?? []);
    for (const tab of this.tabs) {
      if (!tab.dirty) continue;
      dirtyPaths.add(tab.path);
      if (classifyFile(tab.path) === 'bpmn') dirtyPaths.add(extensionsPathFor(tab.path));
    }
    return {
      ready: this.ready,
      ...(this.startupError ? { startupError: this.startupError } : {}),
      ...(ws ? { project: { name: ws.name, key: ws.key, label: ws.label, kind: ws.adapter.kind, paths: ws.model.paths(), dirtyPaths } } : {}),
      tabs: this.tabs.map(tabState),
      ...(this.activeId ? { activeTabId: this.activeId } : {}),
      layout: this.layout,
      settings: this.settings,
      toasts: this.toasts,
      ...(this.dialog ? { dialog: this.dialog } : {}),
      projects: this.projects,
      recent: this.recent,
      dropActive: this.dropActive,
      closedCount: this.closed.length,
      lossReportPaths: [...this.lossReports.keys()],
      folderSupported: FsAccessStorage.isSupported(),
      revision: this.revision,
    };
  }

  get workspace(): ProjectWorkspace | undefined {
    return this.ws;
  }

  get activeTab(): TabInternal | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  // --- startup ----------------------------------------------------------------------------------------------------------

  /** Opens the browser workspace and the project of the last session (or a new default project). */
  async init(): Promise<void> {
    try {
      let adapter: StorageAdapter | undefined;
      try {
        this.idb = await IndexedDbStorage.open();
      } catch (e) {
        this.toast(`Browser storage is not available (${errorText(e)}). Changes are kept in memory only; export a zip to keep them.`, 'error');
      }
      if (this.idb) {
        const last = await this.idb.getMeta<{ key: string; name: string; kind: string }>('lastProject');
        if (last?.kind === 'indexeddb' && (await this.idb.hasProject(last.name))) adapter = await this.idb.openProject(last.name);
        else {
          const projects = await this.idb.listProjects();
          adapter = projects[0] ? await this.idb.openProject(projects[0].name) : await this.createDefaultProject();
        }
      } else {
        adapter = await this.memoryProject(DEFAULT_PROJECT);
      }
      await this.activateWorkspace(adapter, { restoreSession: true });
    } catch (e) {
      this.startupError = errorText(e);
    }
    this.ready = true;
    await this.refreshLists();
    this.notify();
  }

  private async createDefaultProject(): Promise<StorageAdapter> {
    if (!this.idb) return this.memoryProject(DEFAULT_PROJECT);
    return this.createProjectWithFiles(await this.idb.uniqueProjectName(DEFAULT_PROJECT));
  }

  private async memoryProject(name: string): Promise<StorageAdapter> {
    const adapter = new MemoryStorage(name);
    await this.seedProject(adapter, name);
    return adapter;
  }

  private async createProjectWithFiles(name: string): Promise<StorageAdapter> {
    const adapter = await this.idb!.createProject(name);
    await this.seedProject(adapter, name);
    return adapter;
  }

  /** `project.json` and one empty process, the content of every new project. */
  private async seedProject(adapter: StorageAdapter, name: string): Promise<void> {
    const now = new Date().toISOString();
    await adapter.write('project.json', `${JSON.stringify({ name, version: '1.0.0', activiti: '9.0.0', created: now, modified: now }, null, 2)}\n`);
    for (const file of createFromTemplate('empty-process', { name: 'process', paths: [] }).files) await adapter.write(file.path, file.content);
  }

  private async refreshLists(): Promise<void> {
    if (!this.idb) return;
    this.projects = await this.idb.listProjects();
    // a folder without a stored handle cannot be reopened
    this.recent = (await this.idb.listRecent()).filter((r) => r.kind !== 'fs-access' || r.handle !== undefined);
  }

  // --- opening projects -----------------------------------------------------------------------------------------------

  /** Whether the open tabs can be replaced: asks about unsaved changes. */
  private async confirmLeaveProject(): Promise<boolean> {
    const dirty = this.tabs.filter((t) => t.dirty);
    const dirtyFiles = this.ws?.model.dirtyPaths() ?? [];
    if (dirty.length === 0 && dirtyFiles.length === 0) return true;
    const answer = await this.askChoice({
      title: 'Unsaved changes',
      message: `${dirty.length || dirtyFiles.length} file(s) in "${this.ws?.name}" have unsaved changes.`,
      choices: [
        { id: 'save', label: 'Save all', primary: true },
        { id: 'discard', label: "Don't save", danger: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (answer === 'cancel' || answer === undefined) return false;
    if (answer === 'save') return this.saveAll();
    await this.ws?.discardDrafts();
    return true;
  }

  private async activateWorkspace(adapter: StorageAdapter, options: { restoreSession?: boolean; extra?: Partial<RecentProject> } = {}): Promise<void> {
    const ws = await ProjectWorkspace.open(adapter, this.idb);
    this.unsubscribeModel?.();
    for (const tab of this.tabs) tab.handle = undefined;
    this.tabs = [];
    this.activeId = undefined;
    this.closed = [];
    this.lossReports.clear();
    this.ws = ws;
    this.unsubscribeModel = ws.model.onChange(() => this.notify());
    if (ws.loadFailures.length > 0) this.toast(`${ws.loadFailures.length} file(s) could not be read`, 'error', ws.loadFailures.map((f) => `${f.path}: ${f.message}`).join('\n'));
    if (this.idb) {
      const entry = { key: ws.key, kind: adapter.kind === 'memory' ? 'indexeddb' : (adapter.kind as RecentProject['kind']), name: ws.name } as const;
      try {
        await this.idb.addRecent({ ...entry, ...options.extra });
      } catch {
        // a folder handle that cannot be stored: the folder opens now, but it cannot be reopened from the recent list
        await this.idb.addRecent({ ...entry, ...(options.extra?.url ? { url: options.extra.url } : {}) }).catch(() => undefined);
      }
      await this.idb.setMeta('lastProject', { key: ws.key, name: ws.name, kind: adapter.kind });
      await this.refreshLists();
    }
    // unsaved edits of the last session (reload, crash): back as working copies
    const drafts = await ws.pendingDrafts();
    if (drafts.length > 0) {
      ws.recover(drafts);
      this.toast(`Recovered unsaved changes in ${drafts.length} file(s) from your last session`, 'info', drafts.map((d) => d.path).join('\n'));
    }
    const session = options.restoreSession && this.settings.restoreSession && this.idb ? await this.idb.getMeta<SessionRecord>(`session:${ws.key}`) : undefined;
    for (const entry of session?.tabs ?? []) if (ws.model.has(entry.path)) this.openTab(entry.path, { view: entry.view, activate: false });
    for (const path of ws.model.dirtyPaths()) {
      const owner = this.ownerOf(path);
      if (owner && !this.tabs.some((t) => t.path === owner)) this.openTab(owner, { activate: false });
    }
    if (this.tabs.length === 0) {
      const first = ws.model.paths().find((p) => classifyFile(p) === 'bpmn');
      if (first) this.openTab(first, { activate: false });
    }
    const active = this.tabs.find((t) => t.path === session?.active) ?? this.tabs[0];
    this.activeId = active?.id;
    this.notify();
  }

  /** The path whose tab edits `path` (an extensions file belongs to its process file). */
  private ownerOf(path: string): string | undefined {
    const ws = this.ws;
    if (!ws) return undefined;
    if (classifyFile(path) === 'extensions') return bpmnPathForExtensions(path, ws.model.paths());
    return ws.model.has(path) ? path : undefined;
  }

  async openWorkspace(adapter: StorageAdapter, extra?: Partial<RecentProject>): Promise<boolean> {
    if (!(await this.confirmLeaveProject())) return false;
    try {
      await this.activateWorkspace(adapter, { restoreSession: adapter.kind === 'indexeddb', ...(extra ? { extra } : {}) });
      this.closeDialog();
      return true;
    } catch (e) {
      this.alert('Cannot open the project', errorText(e));
      return false;
    }
  }

  async openProject(name: string): Promise<void> {
    if (!this.idb) return;
    await this.openWorkspace(await this.idb.openProject(name));
  }

  async newProject(name?: string): Promise<void> {
    if (!this.idb) {
      this.alert('Browser storage is not available', 'Projects cannot be created without IndexedDB. Open a local folder or import a zip instead.');
      return;
    }
    const chosen =
      name ??
      (await this.askText({
        title: 'New project',
        label: 'Project name',
        initial: await this.idb.uniqueProjectName('new-project'),
        confirmLabel: 'Create',
        validate: (value) => (/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(value.trim()) ? undefined : 'Use letters, digits, ".", "_", "-" and spaces (at most 64 characters)'),
      }));
    if (chosen === undefined) return;
    try {
      if (!(await this.confirmLeaveProject())) return;
      const adapter = await this.createProjectWithFiles(chosen.trim());
      await this.activateWorkspace(adapter);
      this.closeDialog();
    } catch (e) {
      this.alert('Cannot create the project', errorText(e));
    }
  }

  async deleteProject(name: string): Promise<void> {
    if (!this.idb) return;
    const answer = await this.askChoice({
      title: 'Delete project',
      message: `Delete the project "${name}" and all its files from this browser?`,
      detail: 'This cannot be undone. Export a zip first if you want to keep a copy.',
      choices: [
        { id: 'delete', label: 'Delete', danger: true },
        { id: 'cancel', label: 'Cancel', primary: true },
      ],
    });
    if (answer !== 'delete') return;
    const isOpen = this.ws?.key === `idb:${name}`;
    await this.idb.deleteProject(name);
    if (isOpen) {
      const rest = await this.idb.listProjects();
      for (const tab of this.tabs) tab.dirty = false;
      this.ws?.model.load([]);
      await this.activateWorkspace(rest[0] ? await this.idb.openProject(rest[0].name) : await this.createDefaultProject());
    }
    await this.refreshLists();
    this.notify();
  }

  async openLocalFolder(): Promise<void> {
    try {
      const storage = await FsAccessStorage.pick();
      if (!storage) return;
      if (!(await storage.ensurePermission())) {
        this.alert('No access to the folder', 'The browser did not grant read and write access to the folder.');
        return;
      }
      await this.openWorkspace(storage, { handle: storage.root });
    } catch (e) {
      this.alert('Cannot open the folder', errorText(e));
    }
  }

  /**
   * Opens a project of the modeler server's workspace: asks for the workspace URL, lists its projects (top-level folders) and asks
   * which one to open. A name that does not exist yet starts a new project there.
   */
  async openServerWorkspace(url?: string, project?: string): Promise<void> {
    const chosenUrl =
      url ??
      (await this.askText({
        title: 'Open server workspace',
        label: 'Workspace URL of the modeler server',
        initial: connection.workspaceUrl(),
        confirmLabel: 'Next',
        hint: 'The dev endpoint /api/dev/workspace of the modeler server; connect with Run > Connect to server first (the workspace needs the modeler user).',
        validate: (value) => (value.trim() ? undefined : 'Enter a URL'),
      }));
    if (chosenUrl === undefined) return;
    try {
      const headers = connection.authHeaders();
      const existing = await ServerWorkspaceStorage.listProjects({ url: chosenUrl.trim(), headers });
      const chosen =
        project ??
        (await this.askText({
          title: 'Project on the server',
          label: 'Project folder',
          initial: existing[0] ?? 'my-project',
          confirmLabel: 'Open',
          hint: existing.length > 0 ? `Projects in this workspace: ${existing.join(', ')}. A new name starts a new project.` : 'The workspace has no project yet: this name starts one.',
          validate: (value) => (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.trim()) ? undefined : 'Use letters, digits, ".", "_" and "-" (at most 64 characters)'),
        }));
      if (chosen === undefined) return;
      const name = chosen.trim();
      const storage = new ServerWorkspaceStorage({ url: chosenUrl.trim(), project: name, allowMissing: true, headers });
      const isNew = !existing.includes(name);
      if (isNew) await this.seedProject(storage, name);
      await this.openWorkspace(storage, { url: storage.url, project: name });
    } catch (e) {
      const status = (e as { status?: number }).status;
      this.alert('Cannot open the server workspace', errorText(e), status === 401 || status === 403 ? 'The server needs a signed-in user with the dev rights (modeler). Use Run > Connect to server, then open the workspace again.' : undefined);
    }
  }

  /** Reopens an entry of the recent list (the folder permission prompt needs this click). */
  async openRecent(entry: RecentProject): Promise<void> {
    try {
      if (entry.kind === 'indexeddb') {
        await this.openProject(entry.name);
      } else if (entry.kind === 'fs-access') {
        const storage = new FsAccessStorage(entry.handle as FsAccessStorage['root']);
        if (!(await storage.ensurePermission())) {
          this.alert('No access to the folder', 'Allow access to the folder to open it again.');
          return;
        }
        await this.openWorkspace(storage, { handle: entry.handle });
      } else if (entry.url) {
        await this.openServerWorkspace(entry.url, entry.project ?? '');
      }
    } catch (e) {
      this.alert('Cannot open the project', errorText(e));
      await this.idb?.removeRecent(entry.key);
      await this.refreshLists();
      this.notify();
    }
  }

  // --- zip ------------------------------------------------------------------------------------------------------------------

  /** Imports a project zip as a new project of the browser workspace and opens it. */
  async importZipData(bytes: Uint8Array, fileName: string): Promise<void> {
    try {
      const imported = importZip(bytes);
      if (imported.files.length === 0) {
        this.alert('Nothing to import', `${fileName} contains no project files (text files like .bpmn20.xml, .dmn or .json).`, imported.warnings.join('\n'));
        return;
      }
      if (!this.idb) {
        this.alert('Browser storage is not available', 'A zip can only be imported into the browser workspace.');
        return;
      }
      if (!(await this.confirmLeaveProject())) return;
      const name = await this.idb.uniqueProjectName(projectNameFromZip(imported.files, fileName));
      const adapter = await this.idb.createProject(name);
      for (const file of imported.files) await adapter.write(file.path, file.content);
      await this.activateWorkspace(adapter);
      this.closeDialog();
      this.toast(`Imported ${imported.files.length} file(s) as project "${name}"`, 'success', imported.warnings.join('\n') || undefined);
    } catch (e) {
      this.alert('Cannot import the zip', errorText(e));
    }
  }

  /** Saves everything, then downloads the project in the ADR 0003 layout. */
  async exportProjectZip(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    if (!(await this.saveAll())) return;
    // the connector files of the zip hold only what the runtime reads (ADR 0003); a file that still carries more is cleaned in the zip
    const normalized = normalizeConnectorFiles(ws.model.snapshot());
    const bytes = exportZip(normalized.files);
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `${ws.name}.zip`);
    this.toast(`Exported ${ws.model.paths().length} file(s) to ${ws.name}.zip`, 'success', normalized.warnings.join('\n') || undefined);
  }

  // --- files ------------------------------------------------------------------------------------------------------------------

  private processIds(): string[] {
    const ws = this.ws;
    if (!ws) return [];
    return ws.model.paths().filter((p) => classifyFile(p) === 'bpmn').flatMap((p) => scanProcessIds(ws.model.read(p) ?? ''));
  }

  private decisionIds(): string[] {
    const ws = this.ws;
    if (!ws) return [];
    return ws.model.paths().filter((p) => classifyFile(p) === 'dmn').flatMap((p) => scanDecisionIds(ws.model.read(p) ?? ''));
  }

  /** Creates the files of a template (asking for a name) and opens the main one. */
  async newFromTemplate(id: TemplateId, name?: string): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    const info = TEMPLATES.find((t) => t.id === id)!;
    const taken = new Set(ws.model.paths());
    const suggestion = splitName(basename(uniquePath(joinPath(info.folder, `${info.defaultName}${info.suffix}`), (p) => taken.has(p)))).stem;
    const context = (value: string) => ({
      name: value,
      paths: ws.model.paths(),
      processIds: this.processIds(),
      decisionIds: this.decisionIds(),
      processKey: this.processIds()[0] ?? 'process',
    });
    const chosen =
      name ??
      (await this.askText({
        title: `New ${info.label.toLowerCase()}`,
        label: 'File name',
        initial: suggestion,
        confirmLabel: 'Create',
        hint: info.description,
        validate: (value) => {
          if (!value.trim()) return 'Enter a name';
          try {
            createFromTemplate(id, context(value));
            return undefined;
          } catch (e) {
            return errorText(e);
          }
        },
      }));
    if (chosen === undefined) return;
    try {
      const result = createFromTemplate(id, context(chosen));
      for (const file of result.files) await ws.createFile(file.path, file.content);
      this.closeDialog();
      this.openTab(result.files[0]!.path);
      this.toast(`Created ${result.files.map((f) => f.path).join(', ')}`, 'success');
    } catch (e) {
      this.alert('Cannot create the file', errorText(e));
    }
  }

  async renameFile(path: string): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    const kind = classifyFile(path);
    if (kind === 'extensions' && bpmnPathForExtensions(path, ws.model.paths())) {
      this.alert('Rename the process file', `${path} belongs to a process; rename the process file and its extensions file follows.`);
      return;
    }
    const files = kind === 'bpmn' ? [path, extensionsPathFor(path)].filter((p) => ws.model.has(p)) : [path];
    if (this.tabs.some((t) => t.dirty && files.includes(t.path)) || files.some((p) => ws.model.isDirty(p))) {
      this.alert('Save first', `${basename(path)} has unsaved changes. Save or discard them before renaming the file.`);
      return;
    }
    const current = basename(path);
    const target = await this.askText({
      title: 'Rename file',
      label: 'New name',
      initial: current,
      confirmLabel: 'Rename',
      hint: kind === 'bpmn' ? 'The extensions file is renamed with the process file.' : undefined,
      validate: (value) => {
        const next = joinPath(dirname(path), value.trim());
        const problem = value.includes('/') ? 'Enter a file name, not a path' : pathProblem(next);
        if (problem) return problem;
        if (kind !== 'other' && classifyFile(next) !== kind) return `The name must keep the file type (${splitName(current).suffix || kind})`;
        if (next !== path && files.some((f) => ws.model.has(f === path ? next : extensionsPathFor(next)))) return `A file ${next} already exists`;
        return undefined;
      },
    });
    if (target === undefined) return;
    const next = joinPath(dirname(path), target.trim());
    if (next === path) return;
    try {
      await ws.renameFile(path, next);
      if (kind === 'bpmn' && ws.model.has(extensionsPathFor(path))) await ws.renameFile(extensionsPathFor(path), extensionsPathFor(next));
      if (kind === 'connector') await this.moveConnectorMeta(path, next);
      for (const tab of this.tabs) {
        if (tab.path === path) {
          tab.path = next;
          tab.title = basename(next);
        }
      }
      this.closed = this.closed.map((p) => (p === path ? next : p));
      this.persistSessionSoon();
      this.notify();
    } catch (e) {
      this.alert('Cannot rename the file', errorText(e));
    }
  }

  async deleteFile(path: string): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    const kind = classifyFile(path);
    const files = kind === 'bpmn' ? [path, extensionsPathFor(path)].filter((p) => ws.model.has(p)) : [path];
    const answer = await this.askChoice({
      title: 'Delete file',
      message: `Delete ${files.join(' and ')}?`,
      detail: `This removes the file from ${ws.label.toLowerCase()} (${ws.name}). It cannot be undone.`,
      choices: [
        { id: 'delete', label: 'Delete', danger: true },
        { id: 'cancel', label: 'Cancel', primary: true },
      ],
    });
    if (answer !== 'delete') return;
    try {
      this.tabs = this.tabs.filter((t) => !files.includes(t.path));
      if (!this.tabs.some((t) => t.id === this.activeId)) this.activeId = this.tabs[this.tabs.length - 1]?.id;
      for (const file of files) await ws.deleteFile(file);
      if (kind === 'connector') await this.moveConnectorMeta(path);
      this.closed = this.closed.filter((p) => !files.includes(p));
      this.persistSessionSoon();
      this.notify();
    } catch (e) {
      this.alert('Cannot delete the file', errorText(e));
    }
  }

  /** Files dropped onto the page (or chosen with the import button): put in the folder of their kind and opened. */
  async importFiles(files: Array<{ name: string; text: string }>): Promise<void> {
    const ws = this.ws;
    if (!ws || files.length === 0) return;
    const taken = new Set(ws.model.paths());
    const created: string[] = [];
    // new names: a process file and its extensions file keep their common base name
    const renames = new Map<string, string>();
    const planned = files.map((file) => {
      let name = basename(file.name);
      if (/\.bpmn$/i.test(name)) name = name.replace(/\.bpmn$/i, '.bpmn20.xml');
      return { ...file, name };
    });
    for (const file of planned.filter((f) => classifyFile(f.name) === 'bpmn')) {
      const target = uniquePath(joinPath(defaultFolderFor(file.name), file.name), (p) => taken.has(p) || taken.has(extensionsPathFor(p)));
      renames.set(extensionsPathFor(joinPath(defaultFolderFor(file.name), file.name)), extensionsPathFor(target));
      taken.add(target);
      created.push(target);
      await this.writeImported(target, file.text);
    }
    for (const file of planned.filter((f) => classifyFile(f.name) !== 'bpmn')) {
      const wanted = joinPath(defaultFolderFor(file.name), file.name);
      const target = renames.get(wanted) ?? uniquePath(wanted, (p) => taken.has(p));
      taken.add(target);
      created.push(target);
      await this.writeImported(target, file.text);
    }
    const open = created.find((p) => classifyFile(p) === 'bpmn') ?? created.find((p) => classifyFile(p) === 'dmn') ?? created[0];
    if (open) this.openTab(open);
    this.toast(`Imported ${created.length} file(s)`, 'success', created.join('\n'));
    // several processes at once open only one of them: say that the others carry Camunda 7 extensions too (U17)
    const bpmn = planned.filter((f) => classifyFile(f.name) === 'bpmn');
    const camunda = bpmn.filter((f) => detectCamunda(f.text).found).length;
    if (bpmn.length > 1 && camunda > 0 && this.settings.offerCamundaConversion) this.toast(t('camunda.importedOffer', { count: camunda }), 'info');
  }

  private async writeImported(path: string, text: string): Promise<void> {
    try {
      let content = text.replace(BOM, '');
      if (classifyFile(path) === 'connector') content = await this.importConnector(path, content);
      await this.ws!.createFile(path, content);
    } catch (e) {
      this.toast(`Could not import ${path}`, 'error', errorText(e));
    }
  }

  /**
   * A connector descriptor from elsewhere may carry fields the Activiti runtime does not read (template version, config, ...): the file
   * is written with the runtime's fields only and the rest goes to project.json, `connectors.<name>` (ADR 0003). Says so in a toast.
   */
  private async importConnector(path: string, content: string): Promise<string> {
    const ws = this.ws!;
    const split = splitConnectorFile(content);
    if (!split) return content;
    const warnings = connectorSplitWarnings(path, split);
    if (split.meta) {
      try {
        const base = ws.model.read('project.json');
        const key = connectorKeyOf(path);
        const text = writeConnectorMeta(base, key, { ...split.meta, ...(readConnectorMeta(base)[key] ?? {}) });
        if (ws.model.isDirty('project.json') || base === undefined) await ws.edit('project.json', text);
        else await ws.saveFile('project.json', text);
      } catch (e) {
        this.toast(`${path}: its extra fields stay in the file`, 'error', errorText(e));
        return content;
      }
    }
    if (warnings.length > 0) this.toast(`Imported ${path} with changes`, 'info', warnings.join('\n'));
    return split.content;
  }

  /** The entry of a connector in project.json follows the file when it is renamed (`to`) or goes with it when it is deleted (no `to`). */
  private async moveConnectorMeta(from: string, to?: string): Promise<void> {
    const ws = this.ws;
    const base = ws?.model.read('project.json');
    if (!ws || base === undefined) return;
    const meta = readConnectorMeta(base)[connectorKeyOf(from)];
    if (!meta || (to !== undefined && connectorKeyOf(to) === connectorKeyOf(from))) return;
    try {
      let text = writeConnectorMeta(base, connectorKeyOf(from), undefined);
      if (to !== undefined) text = writeConnectorMeta(text, connectorKeyOf(to), meta);
      if (ws.model.isDirty('project.json')) await ws.edit('project.json', text);
      else await ws.saveFile('project.json', text);
    } catch (e) {
      this.toast(`The version and configuration of ${connectorKeyOf(from)} stay under its old name in project.json`, 'error', errorText(e));
    }
  }

  // --- tabs ------------------------------------------------------------------------------------------------------------------

  private makeHost(tabId: string): EditorHost {
    const tab = () => this.tabs.find((t) => t.id === tabId);
    return {
      workspace: this.ws!,
      isMac: this.isMac,
      setHandle: (handle) => {
        const t = tab();
        if (t) t.handle = handle;
      },
      setDirty: (dirty) => {
        const t = tab();
        if (t && t.dirty !== dirty) {
          t.dirty = dirty;
          this.notify();
        }
      },
      setWarnings: (warnings) => {
        const t = tab();
        if (t) {
          t.warnings = warnings;
          this.notify();
        }
      },
      fail: (message, detail, textFiles) => {
        const t = tab();
        if (t) {
          t.error = { message, ...(detail ? { detail } : {}), textFiles: textFiles ?? [t.path] };
          t.handle = undefined;
          this.notify();
        }
      },
      openWith: (editorId) => {
        const t = tab();
        if (t) this.openTab(t.path, { editor: editorId });
      },
      setView: (view) => {
        const t = tab();
        if (t && t.view !== view) {
          t.view = view;
          this.persistSessionSoon();
          this.notify();
        }
      },
      toast: (message, kind, detail) => this.toast(message, kind, detail),
      layout: () => this.layout,
      setLayout: (patch) => this.setLayout(patch),
      settings: () => this.settings,
      showLossReport: (report) => {
        const t = tab();
        if (t) this.showLossReport(t.path, report);
      },
      requestSave: async () => {
        const t = tab();
        if (t) await this.saveTab(t);
      },
      paths: () => new Set(this.ws?.model.paths() ?? []),
    };
  }

  /** Opens a file in a tab (or shows its tab). An extensions file opens its process in the JSON view. */
  openTab(path: string, options: { view?: BpmnView; activate?: boolean; editor?: string } = {}): TabState | undefined {
    const ws = this.ws;
    if (!ws) return undefined;
    let view = options.view;
    let target = path;
    if (classifyFile(path) === 'extensions' && !options.editor) {
      const owner = bpmnPathForExtensions(path, ws.model.paths());
      if (owner) {
        target = owner;
        view ??= 'json';
      }
    }
    const existing = this.tabs.find((t) => t.path === target);
    if (existing) {
      if (view) existing.view = view;
      if (options.editor && existing.editor !== options.editor) {
        existing.editor = options.editor;
        delete existing.error;
      }
      if (options.activate !== false) this.activeId = existing.id;
      this.persistSessionSoon();
      this.notify();
      return existing;
    }
    const editor = options.editor ?? editorFor(target)?.id ?? 'text';
    const id = `tab-${this.nextId++}`;
    const tab: TabInternal = {
      id,
      path: target,
      editor,
      view: view ?? 'diagram',
      title: basename(target),
      dirty: ws.model.isDirty(target) || (classifyFile(target) === 'bpmn' && ws.model.isDirty(extensionsPathFor(target))),
      warnings: [],
      host: undefined as unknown as EditorHost,
    };
    tab.host = this.makeHost(id);
    this.tabs.push(tab);
    if (options.activate !== false) this.activeId = id;
    this.persistSessionSoon();
    this.notify();
    return tab;
  }

  /**
   * The fail-safe of an error tab: opens a file (the tab's own or a related one, e.g. its extensions JSON) in the plain text
   * editor so that it can be fixed by hand. The error tab itself stays, so its file can be reopened with the real editor.
   */
  openAsText(tabId: string, path?: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const target = path ?? tab.path;
    if (target === tab.path) {
      tab.editor = 'text';
      delete tab.error;
      this.notify();
    } else {
      this.openTab(target, { editor: 'text' });
    }
  }

  hostFor(tabId: string): EditorHost {
    return this.tabs.find((t) => t.id === tabId)!.host;
  }

  activateTab(id: string): void {
    if (this.tabs.some((t) => t.id === id) && this.activeId !== id) {
      this.activeId = id;
      this.persistSessionSoon();
      this.notify();
    }
  }

  async closeTab(id: string = this.activeId ?? ''): Promise<boolean> {
    const tab = this.tabs.find((t) => t.id === id);
    const ws = this.ws;
    if (!tab || !ws) return false;
    if (tab.dirty) {
      const answer = await this.askChoice({
        title: 'Unsaved changes',
        message: `Save the changes to ${tab.title} before closing?`,
        detail: 'Your changes will be lost if you do not save them.',
        choices: [
          { id: 'save', label: 'Save', primary: true },
          { id: 'discard', label: "Don't save", danger: true },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      if (answer === 'save') {
        if (!(await this.saveTab(tab))) return false;
      } else if (answer === 'discard') {
        await this.discardWorkingCopies(tab.path);
      } else {
        return false;
      }
    }
    const index = this.tabs.findIndex((t) => t.id === id);
    this.tabs.splice(index, 1);
    this.closed = [...this.closed.filter((p) => p !== tab.path), tab.path].slice(-MAX_CLOSED);
    if (this.activeId === id) this.activeId = (this.tabs[index] ?? this.tabs[index - 1])?.id;
    this.persistSessionSoon();
    this.notify();
    return true;
  }

  private async discardWorkingCopies(path: string): Promise<void> {
    const ws = this.ws!;
    for (const p of classifyFile(path) === 'bpmn' ? [path, extensionsPathFor(path)] : [path]) await ws.discard(p);
    if (classifyFile(path) === 'connector') await this.discardConnectorMeta(path);
  }

  /** The editor of a connector keeps its version and configuration in the working copy of project.json: discarding the connector takes them back to what is saved. */
  private async discardConnectorMeta(path: string): Promise<void> {
    const ws = this.ws!;
    if (!ws.model.isDirty('project.json')) return;
    const saved = ws.model.saved('project.json');
    if (saved === undefined) {
      await ws.discard('project.json');
      return;
    }
    try {
      await ws.edit('project.json', writeConnectorMeta(ws.model.read('project.json'), connectorKeyOf(path), readConnectorMeta(saved)[connectorKeyOf(path)]));
    } catch {
      // project.json was edited by hand into something unreadable: leave it to its own tab
    }
  }

  reopenClosed(): void {
    const ws = this.ws;
    while (ws && this.closed.length > 0) {
      const path = this.closed.pop()!;
      if (ws.model.has(path)) {
        this.openTab(path);
        return;
      }
    }
    this.notify();
  }

  stepTab(delta: 1 | -1): void {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activateTab(this.tabs[(index + delta + this.tabs.length) % this.tabs.length]!.id);
  }

  // --- saving -------------------------------------------------------------------------------------------------------------------

  /** Saves a tab. Resolves to false (after showing why) when it could not be saved. */
  async saveTab(tab: TabInternal | TabState, targetPath?: string): Promise<boolean> {
    const live = this.tabs.find((t) => t.id === tab.id);
    const ws = this.ws;
    if (!live || !ws) return false;
    if (live.error || !live.handle) return !live.dirty;
    try {
      await live.handle.beforeSave?.();
      const target = targetPath ?? live.path;
      const files = await live.handle.serialize(target);
      for (const file of files) await ws.saveFile(file.path, file.content);
      live.handle.markSaved?.(target);
      live.dirty = false;
      this.notify();
      return true;
    } catch (e) {
      this.alert(`Cannot save ${live.title}`, errorText(e));
      return false;
    }
  }

  async save(): Promise<boolean> {
    const tab = this.activeTab;
    return tab ? this.saveTab(tab) : true;
  }

  async saveAs(): Promise<boolean> {
    const tab = this.activeTab;
    const ws = this.ws;
    if (!tab || !ws || tab.error || !tab.handle) return false;
    const kind = classifyFile(tab.path);
    const folder = dirname(tab.path);
    const stem = splitName(basename(tab.path));
    const suggestion = uniquePath(joinPath(folder, `${stem.stem}-copy${stem.suffix}`), (p) => ws.model.has(p) || (kind === 'bpmn' && ws.model.has(extensionsPathFor(p))));
    const target = await this.askText({
      title: 'Save as',
      label: 'Project path of the new file',
      initial: suggestion,
      confirmLabel: 'Save',
      hint: 'A path inside the project, e.g. processes/order.bpmn20.xml. The original file stays as it was saved.',
      validate: (value) => {
        const path = value.trim();
        const problem = pathProblem(path);
        if (problem) return problem;
        if (classifyFile(path) !== kind && !(kind === 'other' && classifyFile(path) === 'other')) return `The new file must have the same type as ${basename(tab.path)}`;
        if (path !== tab.path && (ws.model.has(path) || (kind === 'bpmn' && ws.model.has(extensionsPathFor(path))))) return `A file ${path} already exists`;
        return undefined;
      },
    });
    if (target === undefined) return false;
    const path = target.trim();
    if (path === tab.path) return this.saveTab(tab);
    const old = tab.path;
    const ok = await this.saveTab(tab, path);
    if (!ok) return false;
    // the tab now edits the new file; the original keeps what it had on disk
    await this.discardWorkingCopies(old);
    tab.path = path;
    tab.title = basename(path);
    if (kind === 'bpmn') {
      const others = ws.model
        .paths()
        .filter((p) => p !== path && classifyFile(p) === 'bpmn')
        .filter((p) => scanProcessIds(ws.model.read(p) ?? '').some((id) => scanProcessIds(ws.model.read(path) ?? '').includes(id)));
      if (others.length > 0) this.toast(`The process id is also used by ${others.join(', ')}. Change it, or both files deploy as versions of one process.`, 'error');
    }
    this.persistSessionSoon();
    this.notify();
    return true;
  }

  /** Saves every tab with changes and every other file with a recovered working copy. Resolves to false if one fails. */
  async saveAll(): Promise<boolean> {
    const ws = this.ws;
    if (!ws) return true;
    let ok = true;
    for (const tab of [...this.tabs]) {
      if (tab.dirty && !(await this.saveTab(tab))) ok = false;
    }
    for (const path of ws.model.dirtyPaths()) {
      try {
        await ws.saveFile(path, ws.model.read(path) ?? '');
      } catch (e) {
        ok = false;
        this.alert(`Cannot save ${path}`, errorText(e));
      }
    }
    return ok;
  }

  // --- commands ---------------------------------------------------------------------------------------------------------------

  /** Runs a command id from a menu entry or a shortcut. Resolves when it is done. */
  async run(id: string): Promise<void> {
    switch (id) {
      case 'newFile':
        this.showDialog({ kind: 'templates' });
        return;
      case 'openProject':
        await this.refreshLists();
        this.showDialog({ kind: 'projects' });
        return;
      case 'save':
        await this.save();
        break;
      case 'saveAs':
        await this.saveAs();
        break;
      case 'saveAll':
        await this.saveAll();
        break;
      case 'closeTab':
        await this.closeTab();
        break;
      case 'reopenClosed':
        this.reopenClosed();
        break;
      case 'nextTab':
        this.stepTab(1);
        break;
      case 'prevTab':
        this.stepTab(-1);
        break;
      case 'exportZip':
        await this.exportProjectZip();
        return;
      case 'openFolder':
        await this.openLocalFolder();
        return;
      case 'openServer':
        await this.openServerWorkspace();
        return;
      case 'newProject':
        await this.newProject();
        return;
      case 'exportImage': {
        const answer = await this.askChoice({
          title: 'Export as image',
          message: 'Which format?',
          choices: [
            { id: 'svg', label: 'SVG', primary: true },
            { id: 'png', label: 'PNG' },
            { id: 'cancel', label: 'Cancel' },
          ],
        });
        if (answer === 'svg' || answer === 'png') await this.exportImage(answer);
        break;
      }
      case 'exportSvg':
        await this.exportImage('svg');
        return;
      case 'exportPng':
        await this.exportImage('png');
        return;
      case 'toggleProperties':
        this.setLayout({ propertiesOpen: !this.layout.propertiesOpen });
        break;
      case 'toggleBottom':
        this.setLayout({ bottomOpen: !this.layout.bottomOpen });
        break;
      case 'showLossReport': {
        const path = this.activeTab?.path;
        const report = path ? this.lossReports.get(path) : undefined;
        if (path && report) this.showLossReport(path, report);
        else this.toast('This file was not converted from Camunda 7 in this session', 'info');
        return;
      }
      case 'showVariables':
        this.setLayout({ bottomOpen: true });
        requestBottomTab('variables');
        break;
      case 'toggleExplorer':
        this.setLayout({ explorerOpen: !this.layout.explorerOpen });
        break;
      case 'resetProperties':
        this.setLayout({ propertiesOpen: true, propertiesWidth: DEFAULT_LAYOUT.propertiesWidth });
        break;
      case 'toggleMinimap':
        await this.activeTab?.handle?.perform?.('toggleMinimap');
        return;
      case 'toggleGrid':
        await this.activeTab?.handle?.perform?.('toggleGrid');
        return;
      case 'showShortcuts':
        this.showDialog({ kind: 'shortcuts' });
        return;
      case 'openSettings':
        this.showDialog({ kind: 'settings' });
        return;
      case 'resetLayout':
        this.resetPanelLayout();
        break;
      default:
        await this.activeTab?.handle?.perform?.(id);
        return;
    }
    this.focusActive();
  }

  private async exportImage(format: 'svg' | 'png'): Promise<void> {
    const tab = this.activeTab;
    if (!tab?.handle?.exportImage || tab.view !== 'diagram') {
      this.toast('Open a diagram to export it as an image', 'error');
      return;
    }
    try {
      const blob = await tab.handle.exportImage(format);
      downloadBlob(blob, `${splitName(basename(tab.path)).stem}.${format}`);
    } catch (e) {
      this.alert('Cannot export the image', errorText(e));
    }
  }

  /** Opens the report of a Camunda 7 conversion; the report stays available for the file in the File menu. */
  showLossReport(path: string, report: LossReport): void {
    this.lossReports.set(path, report);
    this.showDialog({ kind: 'lossReport', path, report });
  }

  /** Downloads the report of a conversion as Markdown: `<file>.camunda-import.md`. */
  saveLossReport(path: string): void {
    const report = this.lossReports.get(path);
    if (!report) return;
    const stem = splitName(basename(path)).stem;
    downloadBlob(new Blob([lossReportMarkdown(report)], { type: 'text/markdown' }), `${stem}.camunda-import.md`);
  }

  /** Gives the keyboard focus back to the editor of the visible tab (after a menu or a dialog). */
  focusActive(): void {
    queueMicrotask(() => this.activeTab?.handle?.focus?.());
  }

  // --- layout --------------------------------------------------------------------------------------------------------------------

  /** Changes the layout; `persist: false` while a panel is being dragged (call `persistLayout` when it is dropped). */
  setLayout(patch: Partial<LayoutState>, persist = true): void {
    this.layout = { ...this.layout, ...patch };
    if (persist) saveLayout(this.layout);
    this.notify();
  }

  /** The panels back to their default sizes and visibility (the minimap and the grid are view choices of the diagram and stay). */
  resetPanelLayout(): void {
    const { minimapOpen, gridVisible } = this.layout;
    this.setLayout({ ...DEFAULT_LAYOUT, minimapOpen, gridVisible });
  }

  /** Changes the settings (feature U19) and keeps them in this browser; open editors read them when they next need them. */
  setSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.locale !== undefined && availableLocales().includes(patch.locale)) setLocale(patch.locale);
    saveSettings(this.settings);
    for (const tab of this.tabs) tab.handle?.settingsChanged?.(this.settings);
    this.notify();
  }

  restoreDefaultSettings(): void {
    this.setSettings({ ...DEFAULT_SETTINGS });
  }

  persistLayout(): void {
    saveLayout(this.layout);
  }

  setDropActive(active: boolean): void {
    if (this.dropActive !== active) {
      this.dropActive = active;
      this.notify();
    }
  }

  // --- dialogs and toasts ---------------------------------------------------------------------------------------------------

  private showDialog(dialog: DistributiveOmit<DialogState, 'id'>): number {
    const id = this.nextId++;
    this.dialog = { ...dialog, id } as DialogState;
    this.notify();
    return id;
  }

  closeDialog(): void {
    if (!this.dialog) return;
    const { id } = this.dialog;
    this.dialog = undefined;
    this.resolvers.get(id)?.(undefined);
    this.resolvers.delete(id);
    this.notify();
    this.focusActive();
  }

  /** Called by the dialog component with the user's answer. */
  answerDialog(id: number, value: unknown): void {
    if (this.dialog?.id !== id) return;
    this.dialog = undefined;
    const resolve = this.resolvers.get(id);
    this.resolvers.delete(id);
    this.notify();
    resolve?.(value);
    this.focusActive();
  }

  private ask<T>(dialog: DistributiveOmit<DialogState, 'id'>): Promise<T | undefined> {
    return new Promise((resolve) => {
      const id = this.showDialog(dialog);
      this.resolvers.set(id, resolve as (value: unknown) => void);
    });
  }

  askText(options: { title: string; label: string; initial: string; confirmLabel: string; hint?: string | undefined; validate?: (value: string) => string | undefined }): Promise<string | undefined> {
    return this.ask<string>({ kind: 'prompt', ...options });
  }

  askChoice(options: { title: string; message: string; detail?: string; choices: Array<{ id: string; label: string; primary?: boolean; danger?: boolean }> }): Promise<string | undefined> {
    return this.ask<string>({ kind: 'choice', ...options });
  }

  alert(title: string, message: string, detail?: string): void {
    this.showDialog({ kind: 'alert', title, message, ...(detail ? { detail } : {}) });
  }

  toast(message: string, kind: Toast['kind'] = 'info', detail?: string): void {
    const id = this.nextId++;
    this.toasts = [...this.toasts, { id, kind, message, ...(detail ? { detail } : {}) }].slice(-4);
    this.notify();
    setTimeout(() => this.dismissToast(id), kind === 'error' ? 12000 : 6000);
  }

  dismissToast(id: number): void {
    if (this.toasts.some((t) => t.id === id)) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }
  }

  // --- session ----------------------------------------------------------------------------------------------------------------

  private persistSessionSoon(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistSession(), 250);
  }

  private async persistSession(): Promise<void> {
    if (!this.idb || !this.ws) return;
    const record: SessionRecord = { tabs: this.tabs.map((t) => ({ path: t.path, view: t.view })), ...(this.activeTab ? { active: this.activeTab.path } : {}) };
    try {
      await this.idb.setMeta(`session:${this.ws.key}`, record);
    } catch {
      // the session is a convenience; losing it only means the tabs are not restored
    }
  }

  /** Writes the session now (before the page unloads). */
  flushSession(): Promise<void> {
    clearTimeout(this.persistTimer);
    return this.persistSession();
  }

  /** Reloads the project lists (tests; the app does it when a dialog opens). */
  async refreshForTest(): Promise<void> {
    await this.refreshLists();
    this.notify();
  }

  /** Final bytes of the open project's saved files, for tests of the zip export. */
  snapshotFiles(): ProjectFileData[] {
    return this.ws?.model.snapshot() ?? [];
  }
}
