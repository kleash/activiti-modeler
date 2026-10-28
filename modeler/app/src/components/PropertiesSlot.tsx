import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getDmnPanel, subscribeDmnPanel } from '../editors/dmn/dmnPanel';
import { focusPanelEntry, LINT_FOCUS_EVENT, type LintFocusDetail } from '../properties/focus';
import { getActiveModeler, subscribeActiveModeler } from '../modelerRegistry';
import { useAppState, useController } from '../state/context';
import '../properties/properties.css';

interface PanelHost {
  attachTo(container: HTMLElement): void;
  detach(): void;
}

/**
 * The properties panel of the visible diagram. The panel itself (`ActivitiPropertiesModule`) lives in the modeler of its tab, so
 * the selection and the undo history belong to the tab; this slot attaches the panel of the visible tab to `#properties-panel-slot`
 * and detaches it again when another tab, or the XML or JSON view, takes over.
 */
export function PropertiesSlot() {
  const state = useAppState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  const modeler = useSyncExternalStore(subscribeActiveModeler, getActiveModeler);
  const slot = useRef<HTMLDivElement>(null);
  // the DRD of a DMN tab has a panel of its own (id, name and documentation of the decision model elements)
  const dmnPanel = useSyncExternalStore(subscribeDmnPanel, getDmnPanel);
  const showingBpmn = !!tab && tab.editor === 'bpmn' && tab.view === 'diagram' && !tab.error && !!modeler;
  const showingDmn = !!tab && tab.editor === 'dmn' && tab.view === 'diagram' && !tab.error && !!dmnPanel;
  const showing = showingBpmn || showingDmn;

  useEffect(() => {
    if (!showingBpmn || !slot.current || !modeler) return undefined;
    const panel = modeler.get<PanelHost>('propertiesPanel');
    panel.attachTo(slot.current);
    return () => panel.detach();
  }, [showingBpmn, modeler]);

  useEffect(() => {
    if (!showingDmn || !slot.current || !dmnPanel) return undefined;
    dmnPanel.attachTo(slot.current);
    return () => dmnPanel.detach();
  }, [showingDmn, dmnPanel]);

  return (
    <aside className="properties" aria-label="Properties panel" data-testid="properties-panel">
      <div className="panel-header">
        <span>Properties</span>
      </div>
      <div id="properties-panel-slot" ref={slot} className="panel-body panel-body--panel" hidden={!showing} />
      {!showing && (
        <p className="muted properties-hint">
          {!tab ? 'Open a file to see its properties.' : tab.editor === 'dmn' ? (tab.view !== 'diagram' ? 'Switch to the diagram to edit properties.' : 'Properties are shown while the DRD is open. A decision table or an expression is edited in its own view.') : tab.editor !== 'bpmn' ? 'Properties are shown for BPMN diagrams and for the DRD of a decision model.' : tab.view !== 'diagram' ? 'Switch to the diagram to edit properties.' : 'The properties appear once the diagram is open.'}
        </p>
      )}
    </aside>
  );
}

/**
 * Handles the `activiti.lint.focus` event of the Problems list: shows the panel and the diagram, selects the element and focuses
 * the entry (see properties/focus.ts). Mounted once in the shell, so it also works while the panel is closed.
 */
export function PropertiesFocus() {
  const controller = useController();
  useEffect(() => {
    const onFocus = (event: Event): void => {
      const detail = (event as CustomEvent<LintFocusDetail>).detail;
      if (!detail?.elementId) return;
      const snapshot = controller.getSnapshot();
      if (!snapshot.layout.propertiesOpen) controller.setLayout({ propertiesOpen: true });
      const tab = snapshot.tabs.find((t) => t.id === snapshot.activeTabId);
      if (tab && tab.view !== 'diagram') controller.hostFor(tab.id).setView('diagram');
      void (async () => {
        // the panel attaches in an effect after the layout and the view changed
        await new Promise((resolve) => setTimeout(resolve, 0));
        const modeler = getActiveModeler();
        if (modeler) await focusPanelEntry(modeler, detail, document.getElementById('properties-panel-slot') ?? document);
      })();
    };
    window.addEventListener(LINT_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(LINT_FOCUS_EVENT, onFocus);
  }, [controller]);
  return null;
}
