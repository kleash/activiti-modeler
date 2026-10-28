import { exportProcess, type ExtensionsStore, importProcess, type ProjectCatalog } from '@activiti-modeler/bpmn-js-activiti';
import { convertCamundaBpmn, detectCamunda, extensionsPathFor, parseExtensions, type CamundaDetection, type ProjectFileData } from '@activiti-modeler/activiti-project';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CatalogBuilder, pushCatalog } from '../catalog';
import { t } from '../i18n';
import { lintService } from '../lint/LintService';
import { setActiveModeler } from '../modelerRegistry';
import { SimulationPane, useSimulationGate } from '../run/TokenSimulation';
import { baseNameOf } from '../state/controller';
import type { Settings } from '../state/settings';
import type { BpmnView, EditorProps } from '../state/types';
import { layoutWhenMissing } from './autoLayout';
import { exportDiagramImage, performBpmnAction, selectionCount } from './bpmnActions';
import { JsonView } from './JsonView';
import { createModeler, type ModelerLike } from './modeler';
import { type PendingEdits, XmlView } from './XmlView';

interface CommandStack {
  _stackIdx: number;
}

interface EventBus {
  on(event: string, callback: (event: never) => void): void;
  off(event: string, callback: (event: never) => void): void;
}

const DRAFT_DELAY_MS = 700;

/** Save As: the extensions document is named after the file (`process-<name>`); the copy gets the new name. */
function renameExtensionsId(json: string, oldName: string, newName: string): string {
  if (oldName === newName) return json;
  try {
    const doc = JSON.parse(json) as { id?: unknown };
    if (doc.id !== `process-${oldName}`) return json;
    doc.id = `process-${newName}`;
    return `${JSON.stringify(doc, null, 2)}\n`;
  } catch {
    return json;
  }
}

const VIEWS: Array<{ id: BpmnView; label: string }> = [
  { id: 'diagram', label: 'Diagram' },
  { id: 'xml', label: 'XML' },
  { id: 'json', label: 'Extensions JSON' },
];

/**
 * The BPMN editor of a tab: a bpmn-js modeler with the Activiti modules, plus the XML source and the extensions JSON of the
 * same process. The modeler (and so its undo history) lives as long as the tab; it is hidden, not destroyed, with the tab.
 */
export function BpmnTabEditor({ tab, host, active }: EditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const [modeler, setModeler] = useState<ModelerLike | undefined>();
  // the file uses Camunda extensions: the strip above the canvas offers the conversion (feature U17)
  const [camundaOffer, setCamundaOffer] = useState<CamundaDetection | undefined>();
  // token simulation (U16): only for a diagram without hidden constructs
  const [simulating, setSimulating] = useState(false);
  const simulation = useSimulationGate(tab.path);
  const pathRef = useRef(tab.path);
  pathRef.current = tab.path;
  const viewRef = useRef(tab.view);
  viewRef.current = tab.view;
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingEdits = useRef<PendingEdits | undefined>(undefined);
  const convertRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const importWarnings = useRef<string[]>([]);
  const exportWarnings = useRef<string[]>([]);
  const state = useRef({ savedIdx: -1, forced: false, ready: false });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lintDetach = useRef<(() => void) | undefined>(undefined);
  /** The diagram was loaded while its tab was hidden (zero size): fit it when it is first shown. */
  const needsFit = useRef(false);

  const publishWarnings = useCallback(() => host.setWarnings([...importWarnings.current, ...exportWarnings.current]), [host]);
  const registerEdits = useCallback((edits: PendingEdits | undefined) => void (pendingEdits.current = edits), []);

  useEffect(() => {
    if (!container.current) return undefined;
    const layout = host.layout();
    const instance = createModeler({
      container: container.current,
      minimapOpen: layout.minimapOpen,
      gridVisible: layout.gridVisible,
      defaultMappings: host.settings().defaultMappings,
      onClipboardUnavailable: (message) => host.toast(message, 'info'),
    });
    let disposed = false;
    const ws = host.workspace;
    const bus = instance.get<EventBus>('eventBus');
    const stack = instance.get<CommandStack>('commandStack');
    const store = instance.get<ExtensionsStore>('extensionsStore');
    const paths = () => ({ bpmn: pathRef.current, extensions: extensionsPathFor(pathRef.current) });
    const name = () => baseNameOf(pathRef.current);
    const isDirty = (): boolean => state.current.forced || stack._stackIdx !== state.current.savedIdx;

    // the connectors, DMN decisions and processes of the project, for the panel pickers and the element templates
    const catalog = instance.get<ProjectCatalog>('projectCatalog');
    const catalogBuilder = new CatalogBuilder();
    const lastCatalog: { json?: string } = {};
    let catalogTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshCatalog = (): void => {
      if (disposed) return;
      const paths = ws.model.paths();
      // the template version of a connector is in project.json, which may not be saved yet (the connector editor made it)
      if (!paths.includes('project.json') && ws.model.isDirty('project.json')) paths.push('project.json');
      pushCatalog(catalog, catalogBuilder.build(paths.map((path) => ({ path, content: ws.model.read(path) ?? '' }))), lastCatalog);
    };
    refreshCatalog();
    const stopCatalog = ws.model.onChange(() => {
      clearTimeout(catalogTimer);
      catalogTimer = setTimeout(refreshCatalog, 150);
    });

    const processIds = (): string[] =>
      ((instance.getDefinitions()?.get('rootElements') as Array<{ $instanceOf(t: string): boolean; id?: string }> | undefined) ?? []).filter((r) => r.$instanceOf('bpmn:Process')).map((r) => r.id as string);

    /** Keeps the unsaved state in the project (working copies and drafts) so that a reload loses nothing. */
    const writeDraft = async (): Promise<void> => {
      if (disposed || !state.current.ready) return;
      const { bpmn, extensions } = paths();
      try {
        if (!isDirty()) {
          await ws.discard(bpmn);
          await ws.discard(extensions);
          return;
        }
        const { xml } = await instance.saveXML({ format: true });
        if (xml === undefined || disposed) return;
        await ws.edit(bpmn, xml);
        await ws.edit(extensions, store.serialize(processIds(), name()));
      } catch {
        // drafts are a safety net; a failing one must not disturb editing
      }
    };

    const onChanged = (): void => {
      if (!state.current.ready) return;
      host.setDirty(isDirty());
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => void writeDraft(), DRAFT_DELAY_MS);
    };
    bus.on('commandStack.changed', onChanged as never);
    // an import from outside the editor (XML apply, the test API) starts a new history
    bus.on('import.done', (() => {
      if (state.current.ready) state.current.savedIdx = stack._stackIdx;
    }) as never);
    bus.on('minimap.toggle', ((event: { open: boolean }) => {
      if (event.open !== host.layout().minimapOpen) host.setLayout({ minimapOpen: event.open });
    }) as never);

    const handle = {
      async serialize(target: string): Promise<ProjectFileData[]> {
        const exported = await exportProcess(instance, baseNameOf(target));
        exportWarnings.current = exported.warnings;
        publishWarnings();
        return [
          { path: target, content: exported.xml },
          { path: extensionsPathFor(target), content: renameExtensionsId(exported.extensionsJson, baseNameOf(pathRef.current), baseNameOf(target)) },
        ];
      },
      async beforeSave(): Promise<void> {
        const edits = pendingEdits.current;
        if (edits?.pending() && !(await edits.apply())) {
          throw new Error(viewRef.current === 'xml' ? 'The XML source has errors. Fix them or revert the source before saving.' : 'The extensions JSON has errors. Fix them before saving.');
        }
      },
      markSaved(): void {
        state.current.savedIdx = stack._stackIdx;
        state.current.forced = false;
        host.setDirty(false);
      },
      async perform(action: string): Promise<void> {
        if (action === 'convertCamunda') {
          await convertRef.current?.();
          return;
        }
        try {
          await performBpmnAction(instance, action, { onLayout: (patch) => host.setLayout(patch) });
        } catch (error) {
          // e.g. the browser refuses clipboard access for "copy as image"
          host.toast(`Could not run "${action}": ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      },
      focus(): void {
        if (viewRef.current === 'diagram') instance.get<{ focus(): void }>('canvas').focus();
      },
      selectionCount: () => selectionCount(instance),
      settingsChanged(settings: Settings): void {
        store.defaultMappings = settings.defaultMappings;
      },
      exportImage: (format: 'svg' | 'png') => exportDiagramImage(instance, format),
    };
    host.setHandle(handle);

    const stored = ws.model.read(tab.path);
    const extensionsJson = ws.model.read(extensionsPathFor(tab.path));
    let dirtyAtStart = ws.model.isDirty(tab.path) || ws.model.isDirty(extensionsPathFor(tab.path));
    void (async () => {
      try {
        if (stored === undefined) throw new Error(`${tab.path} no longer exists in the project`);
        // a file without a diagram gets one (U18); the tab is then unsaved, because the file on disk still has none
        let xml = stored;
        let laidOut = false;
        if (host.settings().autoLayout) {
          const layout = await layoutWhenMissing(stored);
          if (disposed) return;
          if (layout.laidOut) {
            xml = layout.xml;
            laidOut = true;
            dirtyAtStart = true;
            host.toast(`${t('layout.generated', { file: tab.title })}${layout.note ? ` ${layout.note}` : ''}`, 'info');
          } else if (layout.note) {
            host.toast(t('layout.skipped', { file: tab.title, reason: layout.note }), 'info');
          }
        }
        let result;
        try {
          result = await importProcess(instance, { xml, ...(extensionsJson !== undefined ? { extensionsJson } : {}), name: baseNameOf(tab.path) });
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Invalid extensions JSON')) {
            throw Object.assign(new Error(`${extensionsPathFor(tab.path)} cannot be read: ${error.message.replace(/^Invalid extensions JSON: /, '')}`), { textFiles: [extensionsPathFor(tab.path)] });
          }
          throw error;
        }
        if (disposed) return;
        importWarnings.current = result.warnings;
        publishWarnings();
        const detection = detectCamunda(xml);
        if (detection.found && host.settings().offerCamundaConversion) setCamundaOffer(detection);
        if (container.current && container.current.offsetWidth > 0) instance.get<{ zoom(level: string, center?: string): void }>('canvas').zoom('fit-viewport', 'auto');
        else needsFit.current = true;
        state.current.savedIdx = stack._stackIdx;
        state.current.forced = dirtyAtStart;
        state.current.ready = true;
        // the layout is a change nobody made with the editor: keep a draft of it like any other
        if (laidOut) draftTimer.current = setTimeout(() => void writeDraft(), DRAFT_DELAY_MS);
        setModeler(instance);
        lintDetach.current = lintService.attach(() => pathRef.current, instance);
        host.setDirty(dirtyAtStart);
        if (activeRef.current) setActiveModeler(instance as never);
      } catch (error) {
        if (disposed) return;
        const textFiles = (error as { textFiles?: string[] }).textFiles ?? [tab.path];
        host.fail(`${tab.title} could not be opened`, error instanceof Error ? error.message : String(error), [...new Set([tab.path, ...textFiles])]);
      }
    })();

    // the canvas follows panel resizing and the tab becoming visible again
    // write the draft right away when the page is hidden or left, instead of waiting for the delay
    const flushDraft = (): void => {
      clearTimeout(draftTimer.current);
      void writeDraft();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushDraft);

    const observer = new ResizeObserver(() => instance.get<{ resized(): void }>('canvas').resized());
    observer.observe(container.current);

    return () => {
      disposed = true;
      stopCatalog();
      clearTimeout(catalogTimer);
      lintDetach.current?.();
      clearTimeout(draftTimer.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushDraft);
      observer.disconnect();
      host.setHandle(undefined);
      setActiveModeler(undefined);
      instance.destroy();
    };
    // the modeler belongs to the tab for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the visible tab is the one the test API and the shortcuts talk to
  useEffect(() => {
    if (!modeler) return;
    if (active) {
      setActiveModeler(modeler as never);
      if (tab.view === 'diagram') {
        const canvas = modeler.get<{ resized(): void; focus(): void; zoom(level: string, center?: string): void }>('canvas');
        canvas.resized();
        if (needsFit.current) {
          needsFit.current = false;
          canvas.zoom('fit-viewport', 'auto');
        }
        canvas.focus();
      }
    }
  }, [active, modeler, tab.view]);

  const switchTo = async (view: BpmnView): Promise<void> => {
    const edits = pendingEdits.current;
    if (edits?.pending() && !(await edits.apply())) return;
    host.setView(view);
  };

  const processIds = useCallback(
    (): string[] =>
      ((modeler?.getDefinitions()?.get('rootElements') as Array<{ $instanceOf(t: string): boolean; id?: string }> | undefined) ?? []).filter((r) => r.$instanceOf('bpmn:Process')).map((r) => r.id as string),
    [modeler],
  );

  const onApplied = useCallback(
    (warnings: string[]) => {
      importWarnings.current = warnings;
      state.current.forced = true;
      host.setDirty(true);
      publishWarnings();
      // the applied source is a change like any other: keep a draft of it
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        const { bpmn, extensions } = { bpmn: pathRef.current, extensions: extensionsPathFor(pathRef.current) };
        if (!modeler) return;
        void (async () => {
          const { xml } = await modeler.saveXML({ format: true });
          if (xml) {
            await host.workspace.edit(bpmn, xml);
            await host.workspace.edit(extensions, modeler.get<ExtensionsStore>('extensionsStore').serialize(processIds(), baseNameOf(bpmn)));
          }
        })().catch(() => undefined);
      }, DRAFT_DELAY_MS);
    },
    [host, modeler, processIds, publishWarnings],
  );

  /**
   * Converts the Camunda 7 extensions of the file to Activiti (feature U17): the file as it was read (or as the editor holds it, when it has
   * been edited), the extensions file that goes with it and the DMN decisions of the project in; the converted diagram and its extensions
   * replace the open ones, the tab is unsaved until the person saves, and the report of what could not be translated is shown.
   */
  const convertCamunda = useCallback(async (): Promise<void> => {
    if (!modeler) return;
    try {
      const store = modeler.get<ExtensionsStore>('extensionsStore');
      const catalog = modeler.get<ProjectCatalog>('projectCatalog');
      const name = baseNameOf(tab.path);
      const edited = tab.dirty || host.workspace.model.isDirty(tab.path);
      const source = edited ? (await modeler.saveXML({ format: true })).xml : host.workspace.model.read(tab.path);
      if (source === undefined) throw new Error(`${tab.path} no longer exists in the project`);
      const detection = detectCamunda(source);
      if (!detection.found) {
        setCamundaOffer(undefined);
        host.toast(t('camunda.none'), 'info');
        return;
      }
      const extensions = parseExtensions(store.serialize(processIds(), name), name);
      const result = convertCamundaBpmn(source, {
        fileName: baseNameOf(tab.path) === name ? tab.title : name,
        extensions,
        decision: (ref) => {
          const found = catalog.decision(ref);
          return found ? { id: found.decision.id, ...(found.decision.name ? { name: found.decision.name } : {}), inputs: found.decision.inputs, outputs: found.decision.outputs.map((o) => ({ ...(o.name ? { name: o.name } : {}), ...(o.type ? { type: o.type } : {}) })) } : undefined;
        },
        defaultMappings: host.settings().defaultMappings,
      });
      const imported = await importProcess(modeler, { xml: result.xml, ...(result.extensionsJson !== undefined ? { extensionsJson: result.extensionsJson } : {}), name });
      modeler.get<{ zoom(level: string, center?: string): void }>('canvas').zoom('fit-viewport', 'auto');
      setCamundaOffer(undefined);
      onApplied(imported.warnings);
      host.showLossReport(result.report);
      host.toast(t('camunda.converted', { converted: result.report.counts.converted, dropped: result.report.counts.dropped, approximated: result.report.counts.approximated }), result.report.counts.dropped > 0 ? 'info' : 'success');
    } catch (error) {
      host.toast(t('camunda.failed'), 'error', error instanceof Error ? error.message : String(error));
    }
  }, [host, modeler, onApplied, processIds, tab.dirty, tab.path, tab.title]);
  convertRef.current = convertCamunda;

  return (
    <div className="bpmn-editor">
      {camundaOffer && tab.view === 'diagram' && (
        <div className="camunda-offer" role="status" data-testid="camunda-offer">
          <span>
            {camundaOffer.zeebe
              ? t('camunda.offerZeebe')
              : camundaOffer.attributes + camundaOffer.elements === 0
                ? t('camunda.offerModeler')
                : t('camunda.offer', { platform: 'Camunda 7', attributes: camundaOffer.attributes, elements: camundaOffer.elements })}
          </span>
          <button type="button" className="btn small primary" onClick={() => void convertCamunda()} disabled={!modeler} data-testid="camunda-convert">
            {t('camunda.convert')}
          </button>
          <button type="button" className="btn small" onClick={() => setCamundaOffer(undefined)} data-testid="camunda-keep">
            {t('camunda.keep')}
          </button>
        </div>
      )}
      <div className="editor-body">
        <div className={`bpmn-stage${tab.view === 'diagram' ? '' : ' hidden'}`}>
          <div ref={container} className={`bpmn-canvas${simulating ? ' under-simulation' : ''}`} data-testid="bpmn-canvas" />
          {simulating && modeler && simulation.allowed && <SimulationPane modeler={modeler} onClose={() => setSimulating(false)} />}
        </div>
        {modeler && tab.view === 'xml' && <XmlView modeler={modeler} name={baseNameOf(tab.path)} register={registerEdits} onApplied={onApplied} />}
        {modeler && tab.view === 'json' && <JsonView modeler={modeler} name={baseNameOf(tab.path)} processIds={processIds} register={registerEdits} />}
      </div>
      <div className="view-switch" role="tablist" aria-label="Show the process as">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={tab.view === v.id} className={tab.view === v.id ? 'selected' : ''} onClick={() => void switchTo(v.id)} disabled={!modeler}>
            {v.label}
          </button>
        ))}
        <span className="spacer" />
        {!simulation.allowed && tab.view === 'diagram' && (
          <span className="muted small simulate-why" role="note" data-testid="simulate-why" title={simulation.explanation}>
            Token simulation is off: {simulation.explanation}
          </span>
        )}
        <button
          type="button"
          className={simulating ? 'selected' : ''}
          aria-pressed={simulating}
          disabled={!modeler || tab.view !== 'diagram' || (!simulation.allowed && !simulating)}
          title={simulation.allowed ? 'Play the diagram with tokens (a copy; nothing is changed)' : simulation.explanation}
          onClick={() => setSimulating(!simulating)}
          data-testid="simulate-toggle"
        >
          Simulate tokens
        </button>
      </div>
    </div>
  );
}
