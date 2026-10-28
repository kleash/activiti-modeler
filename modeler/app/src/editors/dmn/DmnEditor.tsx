import { detectDmnVersion, normalizeDmn, type ProjectFileData } from '@activiti-modeler/activiti-project';
import { migrateDiagram } from '@bpmn-io/dmn-migrate';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DecisionTester, type TesterOutcome } from '../../decision-tester/DecisionTester';
import { baseNameOf } from '../../state/controller';
import { svgToPngBlob } from '../pngImage';
import type { BpmnView, EditorProps } from '../../state/types';
import { type PanelHost, setDmnPanel, getDmnPanel } from './dmnPanel';
import { createDmnModeler, type DmnModelerLike, type DmnView, type DmnViewer, flushDmnInput, pendingDmnInput, ProjectVariables } from './dmnModeler';
import { type PendingDmnEdits, DmnSourceView } from './DmnSourceView';
import { processVariablesFor } from './projectVariables';

import './dmn-editor.css';

const DRAFT_DELAY_MS = 700;
const CHECK_DELAY_MS = 120;

interface EditorActions {
  trigger(action: string, options?: unknown): unknown;
  isRegistered(action: string): boolean;
}

interface Canvas {
  zoom(level: string | number, center?: string): void;
  resized(): void;
  focus(): void;
  addMarker(element: string, marker: string): void;
  removeMarker(element: string, marker: string): void;
}

const VIEW_LABEL: Record<string, string> = { drd: 'DRD', decisionTable: 'table', literalExpression: 'expression', boxedExpression: 'boxed' };

/** The label of a view chip: the DRD, or the name of the decision (business knowledge model) with the kind of its logic. */
export const viewLabel = (view: DmnView): string => (view.type === 'drd' ? 'DRD' : (view.name?.trim() || view.id));

function viewerOf(modeler: DmnModelerLike | undefined): DmnViewer | undefined {
  return modeler?.getActiveViewer();
}

function optionalService<T>(viewer: DmnViewer | undefined, name: string): T | undefined {
  if (!viewer) return undefined;
  try {
    return viewer.get<T>(name, false) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The DMN editor of a tab (features DM1 to DM9): a dmn-js modeler with the DRD, the decision tables, the literal expressions and the
 * boxed expressions of the file, a chip per view, the XML source, and the decision tester. DMN 1.1 and 1.2 files are migrated when they
 * are opened (the tab then counts as changed), and every save writes the portable form (`normalizeDmn`). The modeler, and so its undo
 * history, lives as long as the tab. Files that are no DMN at all open as text, so that they can be fixed by hand.
 */
export function DmnTabEditor({ tab, host, active }: EditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const [modeler, setModeler] = useState<DmnModelerLike | undefined>();
  const [views, setViews] = useState<DmnView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | undefined>();
  const [testerOpen, setTesterOpen] = useState(false);
  const [outcome, setOutcome] = useState<TesterOutcome | undefined>();
  const pathRef = useRef(tab.path);
  pathRef.current = tab.path;
  const viewRef = useRef(tab.view);
  viewRef.current = tab.view;
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingEdits = useRef<PendingDmnEdits | undefined>(undefined);
  const state = useRef({ baseline: '', forced: false, ready: false, lastSerialized: '' });
  const importWarnings = useRef<string[]>([]);
  const exportNotes = useRef<string[]>([]);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const needsFit = useRef(false);
  const projectVariables = useRef(new ProjectVariables());

  const publishWarnings = useCallback(() => host.setWarnings([...importWarnings.current, ...exportNotes.current]), [host]);
  const registerEdits = useCallback((edits: PendingDmnEdits | undefined) => void (pendingEdits.current = edits), []);

  /** The text of the model as it would be saved: dmn-js's XML, made portable. */
  const portableText = useCallback(
    async (instance: DmnModelerLike): Promise<{ raw: string; xml: string; notes: string[] }> => {
      const { xml: raw } = await instance.saveXML({ format: true });
      const result = normalizeDmn(raw, { definitionsName: baseNameOf(pathRef.current) });
      return { raw, xml: result.xml, notes: [...result.changes.map((c) => `Normalized on save: ${c.message}`), ...result.warnings] };
    },
    [],
  );

  useEffect(() => {
    if (!container.current) return undefined;
    const ws = host.workspace;
    let disposed = false;
    const instance = createDmnModeler({ container: container.current, projectVariables: projectVariables.current });

    const refreshVariables = (): void => {
      const files = ws.model
        .paths()
        .filter((p) => p.endsWith('.dmn') || p.endsWith('-extensions.json'))
        .map((path) => ({ path, content: ws.model.read(path) ?? '' }));
      projectVariables.current.set(processVariablesFor(pathRef.current, files));
    };
    refreshVariables();
    const stopVariables = ws.model.onChange(refreshVariables);

    /** The unsaved state in the project (working copy and draft): what the lint and the pickers of the other editors read. */
    const writeDraft = async (): Promise<void> => {
      if (disposed || !state.current.ready) return;
      const path = pathRef.current;
      try {
        const { raw, xml } = await portableText(instance);
        if (disposed) return;
        if (raw === state.current.baseline) {
          if (!state.current.forced) await ws.discard(path);
          return;
        }
        await ws.edit(path, xml);
      } catch {
        // drafts are a safety net; a failing one must not disturb editing
      }
    };

    const check = async (): Promise<void> => {
      if (disposed || !state.current.ready) return;
      try {
        const { xml } = await instance.saveXML({ format: true });
        if (disposed) return;
        host.setDirty(state.current.forced || xml !== state.current.baseline);
        clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(() => void writeDraft(), DRAFT_DELAY_MS);
      } catch {
        // a half-edited cell can make the model unserializable for a moment
      }
    };
    const scheduleCheck = (): void => {
      clearTimeout(checkTimer.current);
      checkTimer.current = setTimeout(() => void check(), CHECK_DELAY_MS);
    };

    instance.on('viewer.created', ((event: { viewer: DmnViewer }) => {
      event.viewer.on('commandStack.changed', scheduleCheck);
      // dmn-js reports no change of the views when only the id of a decision or of the definitions changes (it matches views by element):
      // the chips would keep the old id, and opening one would make the old id the active view
      event.viewer.on('elements.changed', () => {
        if (disposed) return;
        const next = instance.getViews();
        setViews((current) => (current.length === next.length && current.every((v, i) => v.id === next[i]!.id && v.name === next[i]!.name) ? current : [...next]));
        setActiveViewId(instance.getActiveView()?.id);
      });
    }) as never);
    instance.on('views.changed', ((event: { views: DmnView[]; activeView?: DmnView }) => {
      if (disposed) return;
      setViews([...event.views]);
      setActiveViewId(event.activeView?.id);
    }) as never);

    const handle = {
      async serialize(target: string): Promise<ProjectFileData[]> {
        const { raw, xml, notes } = await portableText(instance);
        state.current.lastSerialized = raw;
        exportNotes.current = notes;
        publishWarnings();
        return [{ path: target, content: xml }];
      },
      async beforeSave(): Promise<void> {
        // a label that is being edited in the DRD belongs to the model before it is saved
        optionalService<{ isActive(): boolean; complete(): void }>(viewerOf(instance), 'directEditing')?.complete();
        // a save while the user is still typing in a cell, an expression or a name: leaving the field makes dmn-js take over what was typed
        // (the boxed expression does so on blur only), and the edits that wait for the input delay are executed now
        const typing = document.activeElement;
        if (typing instanceof HTMLElement && container.current?.contains(typing) && typing.closest('[contenteditable="true"], input, textarea')) typing.blur();
        flushDmnInput();
        const edits = pendingEdits.current;
        if (edits?.pending() && !(await edits.apply())) throw new Error('The XML source has errors. Fix them or revert the source before saving.');
      },
      markSaved(): void {
        state.current.baseline = state.current.lastSerialized;
        state.current.forced = false;
        host.setDirty(false);
      },
      perform(action: string): void {
        const viewer = viewerOf(instance);
        if (!viewer) return;
        const stack = optionalService<{ undo(): void; redo(): void }>(viewer, 'commandStack');
        if (action === 'undo') return stack?.undo();
        if (action === 'redo') return stack?.redo();
        const canvas = optionalService<Canvas>(viewer, 'canvas');
        const actions = optionalService<EditorActions>(viewer, 'editorActions');
        switch (action) {
          case 'zoomFit':
            return canvas?.zoom('fit-viewport', 'auto');
          case 'zoomActual':
            return canvas?.zoom(1);
          case 'zoomIn':
            return void actions?.trigger('stepZoom', { value: 1 });
          case 'zoomOut':
            return void actions?.trigger('stepZoom', { value: -1 });
          case 'selectAll':
            return void actions?.trigger('selectElements');
          case 'removeSelection':
          case 'copy':
          case 'cut':
          case 'paste':
          case 'find':
          case 'handTool':
          case 'lassoTool':
          case 'directEditing':
            if (actions?.isRegistered(action)) void actions.trigger(action);
            return;
          default:
        }
      },
      focus(): void {
        if (viewRef.current !== 'diagram') return;
        const canvas = optionalService<Canvas>(viewerOf(instance), 'canvas');
        canvas?.focus();
      },
      selectionCount(): number {
        // the selection of a table is a cell, not a list of elements
        if (instance.getActiveView()?.type !== 'drd') return 0;
        const selected = optionalService<{ get(): unknown[] }>(viewerOf(instance), 'selection')?.get();
        return Array.isArray(selected) ? selected.length : 0;
      },
      async exportImage(format: 'svg' | 'png'): Promise<Blob> {
        const viewer = viewerOf(instance) as unknown as { saveSVG?: () => Promise<{ svg: string }> } | undefined;
        if (!viewer?.saveSVG) throw new Error('Open the DRD to export it as an image');
        const { svg } = await viewer.saveSVG();
        if (format === 'svg') return new Blob([svg], { type: 'image/svg+xml' });
        return svgToPngBlob(svg);
      },
    };
    host.setHandle(handle);
    // the tests of the editor look at the model behind a tab (built into dev and test builds only, like `__modelerTestApi`)
    if (import.meta.env.DEV || import.meta.env.VITE_MODELER_TEST_API === 'true') {
      const registry = ((window as unknown as { __dmnEditors?: Map<string, DmnModelerLike> }).__dmnEditors ??= new Map());
      registry.set(tab.path, instance);
      (window as unknown as { __dmnPendingInput?: () => number }).__dmnPendingInput = pendingDmnInput;
    }

    void (async () => {
      try {
        let xml = ws.model.read(tab.path);
        if (xml === undefined) throw new Error(`${tab.path} no longer exists in the project`);
        const version = detectDmnVersion(xml);
        if (!version) {
          // not a DMN document (an empty file, a stub, another format): the text editor is the way to fix it
          host.openWith('dmn-source');
          return;
        }
        let migratedFrom: string | undefined;
        if (version === '1.1' || version === '1.2') {
          try {
            xml = await migrateDiagram(xml);
            migratedFrom = version;
          } catch (error) {
            throw Object.assign(new Error(`This is a DMN ${version} file and @bpmn-io/dmn-migrate could not migrate it: ${error instanceof Error ? error.message : String(error)}`), {});
          }
        }
        const { warnings } = await instance.importXML(xml);
        if (disposed) return;
        const notes = warnings.map((w) => w.message ?? String(w));
        if (migratedFrom) notes.unshift(`Migrated from DMN ${migratedFrom} to DMN 1.3 with @bpmn-io/dmn-migrate. Save the file to keep the migration.`);
        if (version === '1.4' || version === '1.5') notes.unshift(`This is a DMN ${version} file; the modeler reads and writes DMN 1.3, parts of ${version} that 1.3 does not have are lost when it is saved.`);
        importWarnings.current = notes;
        publishWarnings();
        state.current.baseline = (await instance.saveXML({ format: true })).xml;
        state.current.forced = migratedFrom !== undefined || ws.model.isDirty(tab.path);
        state.current.ready = true;
        setViews([...instance.getViews()]);
        setActiveViewId(instance.getActiveView()?.id);
        setModeler(instance);
        host.setDirty(state.current.forced);
        if (container.current && container.current.offsetWidth > 0) fit(instance);
        else needsFit.current = true;
      } catch (error) {
        if (disposed) return;
        host.fail(`${tab.title} could not be opened`, error instanceof Error ? error.message : String(error), [tab.path]);
      }
    })();

    const flushDraft = (): void => {
      clearTimeout(draftTimer.current);
      void writeDraft();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushDraft);

    const observer = new ResizeObserver(() => {
      const canvas = optionalService<Canvas>(viewerOf(instance), 'canvas');
      canvas?.resized();
    });
    observer.observe(container.current);

    return () => {
      disposed = true;
      stopVariables();
      clearTimeout(checkTimer.current);
      clearTimeout(draftTimer.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushDraft);
      observer.disconnect();
      host.setHandle(undefined);
      if (import.meta.env.DEV || import.meta.env.VITE_MODELER_TEST_API === 'true') (window as unknown as { __dmnEditors?: Map<string, DmnModelerLike> }).__dmnEditors?.delete(pathRef.current);
      instance.destroy();
    };
    // the modeler belongs to the tab for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the properties panel of the DRD belongs to the visible tab, while its diagram view shows the DRD
  useEffect(() => {
    if (!modeler || !active) return undefined;
    let announced: PanelHost | undefined;
    const announce = (): void => {
      const panel = tab.view === 'diagram' && modeler.getActiveView()?.type === 'drd' ? optionalService<PanelHost>(viewerOf(modeler), 'propertiesPanel') : undefined;
      announced = panel;
      setDmnPanel(panel);
    };
    announce();
    modeler.on('views.changed', announce as never);
    return () => {
      modeler.off('views.changed', announce as never);
      if (getDmnPanel() === announced) setDmnPanel(undefined);
    };
  }, [active, modeler, tab.view]);

  // the canvas follows the tab becoming visible, and the first fit waits for a size
  useEffect(() => {
    if (!modeler || !active || tab.view !== 'diagram') return;
    const canvas = optionalService<Canvas>(viewerOf(modeler), 'canvas');
    canvas?.resized();
    if (needsFit.current) {
      needsFit.current = false;
      fit(modeler);
    }
  }, [active, modeler, tab.view]);

  // the rules and decisions a test evaluation matched are marked in the open view
  useEffect(() => {
    const root = container.current;
    if (!root || !modeler || !outcome) return undefined;
    const view = modeler.getActiveView();
    const step = outcome.outcome.decisions.find((d) => d.decisionId === view?.id);
    const ruleIds = step ? step.matchedRules : view?.id === outcome.decisionId ? outcome.outcome.matchedRules : [];
    const mark = (): void => {
      root.querySelectorAll('tr.activiti-matched-rule').forEach((tr) => tr.classList.remove('activiti-matched-rule'));
      for (const id of ruleIds) {
        for (const cell of Array.from(root.querySelectorAll(`[data-row-id="${CSS.escape(id)}"]`))) cell.closest('tr')?.classList.add('activiti-matched-rule');
      }
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(root, { childList: true, subtree: true });
    // in the DRD the evaluated decisions get a marker
    const canvas = view?.type === 'drd' ? optionalService<Canvas>(viewerOf(modeler), 'canvas') : undefined;
    const evaluated = outcome.outcome.decisions.map((d) => d.decisionId);
    for (const id of evaluated) {
      try {
        canvas?.addMarker(id, 'activiti-evaluated');
      } catch {
        // a decision without a shape
      }
    }
    return () => {
      observer.disconnect();
      root.querySelectorAll('tr.activiti-matched-rule').forEach((tr) => tr.classList.remove('activiti-matched-rule'));
      for (const id of evaluated) {
        try {
          canvas?.removeMarker(id, 'activiti-evaluated');
        } catch {
          // the view went away
        }
      }
    };
  }, [outcome, modeler, activeViewId]);

  const switchTo = async (view: BpmnView): Promise<void> => {
    const edits = pendingEdits.current;
    if (edits?.pending() && !(await edits.apply())) return;
    host.setView(view);
  };

  const openView = async (view: DmnView): Promise<void> => {
    if (!modeler) return;
    try {
      await modeler.open(view);
      if (view.type === 'drd') fit(modeler);
    } catch (error) {
      host.toast(`Could not open ${viewLabel(view)}: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const loadSource = useCallback(async (): Promise<string> => (modeler ? (await portableText(modeler)).xml : ''), [modeler, portableText]);

  const applySource = useCallback(
    async (text: string): Promise<void> => {
      if (!modeler) return;
      const previous = (await modeler.saveXML({ format: true })).xml;
      try {
        const version = detectDmnVersion(text);
        if (!version) throw new Error('This is not a DMN document (the root element is not definitions in a DMN namespace)');
        const source = version === '1.1' || version === '1.2' ? await migrateDiagram(text) : text;
        await modeler.importXML(source);
      } catch (error) {
        // the model must not be lost because the source cannot be shown
        try {
          await modeler.importXML(previous);
        } catch {
          // keep the original error
        }
        throw error;
      }
    },
    [modeler],
  );

  const onSourceApplied = useCallback(() => {
    state.current.forced = true;
    host.setDirty(true);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (!modeler) return;
      void (async () => {
        const { xml } = await portableText(modeler);
        await host.workspace.edit(pathRef.current, xml);
      })().catch(() => undefined);
    }, DRAFT_DELAY_MS);
  }, [host, modeler, portableText]);

  const current = views.find((v) => v.id === activeViewId);
  const preferredDecision = current && current.type !== 'drd' ? current.id : undefined;
  const getModel = useCallback(async (): Promise<string> => (modeler ? (await portableText(modeler)).xml : ''), [modeler, portableText]);

  return (
    <div className="dmn-editor">
      <div className="editor-body">
        <div className={`dmn-main${tab.view === 'diagram' ? '' : ' hidden'}`}>
          <div className="dmn-toolbar">
            <div className="dmn-views" role="tablist" aria-label="Views of the decision model" data-testid="dmn-views">
              {views.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-selected={view.id === activeViewId}
                  className={view.id === activeViewId ? 'selected' : ''}
                  data-testid={`dmn-view-${view.type === 'drd' ? 'drd' : view.id}`}
                  title={view.type === 'drd' ? 'The decision requirements diagram' : `${view.name ?? view.id}: ${VIEW_LABEL[view.type]}`}
                  onClick={() => void openView(view)}
                >
                  {viewLabel(view)}
                  {view.type !== 'drd' && <small> {VIEW_LABEL[view.type]}</small>}
                </button>
              ))}
            </div>
            <button type="button" className={`btn${testerOpen ? ' primary' : ''}`} onClick={() => setTesterOpen((open) => !open)} disabled={!modeler} aria-pressed={testerOpen} data-testid="dmn-test-decision" title="Evaluate a decision of this file on the modeler server">
              Test decision
            </button>
          </div>
          <div className="dmn-work">
            <div className="dmn-stage">
              {/* nothing is positioned over the bottom-right corner of a view: the bpmn.io watermark has to stay visible there (U20) */}
              <div ref={container} className="dmn-canvas" data-testid="dmn-canvas" />
            </div>
            {testerOpen && modeler && (
              <DecisionTester
                project={host.workspace.name}
                path={tab.path}
                getModel={getModel}
                preferredDecision={preferredDecision}
                onOutcome={setOutcome}
                close={() => {
                  setTesterOpen(false);
                  setOutcome(undefined);
                }}
              />
            )}
          </div>
        </div>
        {modeler && tab.view === 'xml' && <DmnSourceView load={loadSource} applyText={applySource} register={registerEdits} onApplied={onSourceApplied} />}
      </div>
      <div className="view-switch" role="tablist" aria-label="Show the decision model as">
        {(
          [
            { id: 'diagram', label: 'Model' },
            { id: 'xml', label: 'XML' },
          ] as Array<{ id: BpmnView; label: string }>
        ).map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={tab.view === v.id} className={tab.view === v.id ? 'selected' : ''} onClick={() => void switchTo(v.id)} disabled={!modeler}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function fit(instance: DmnModelerLike): void {
  const canvas = optionalService<Canvas>(viewerOf(instance), 'canvas');
  if (!canvas) return;
  try {
    canvas.zoom('fit-viewport', 'auto');
  } catch {
    // an empty or hidden diagram has nothing to fit
  }
}
