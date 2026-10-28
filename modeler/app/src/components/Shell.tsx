import { useEffect } from 'react';

import { useAppState, useController } from '../state/context';
import { LAYOUT_LIMITS } from '../state/layout';
import { findAppShortcut } from '../state/shortcuts';
import { BottomPanel } from './BottomPanel';
import { Dialogs } from './Dialogs';
import { DropZone } from './DropZone';
import { EditorArea } from './EditorArea';
import { Explorer } from './Explorer';
import { MenuBar } from './MenuBar';
import { PropertiesFocus, PropertiesSlot } from './PropertiesSlot';
import { ConnectionDialog } from '../run/ConnectionDialog';
import { Workbench } from '../run/Workbench';
import { Resizer } from './Resizer';
import { StatusBar } from './StatusBar';
import { TabBar } from './TabBar';
import { Toasts } from './Toasts';

const clamp = (value: number, limits: { min: number; max: number }): number => Math.min(limits.max, Math.max(limits.min, Math.round(value)));

/** Window level keyboard shortcuts of the shell (the tool and editing keys belong to the diagram, see shortcuts.ts). */
function useShellShortcuts(): void {
  const controller = useController();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // bpmn-js already handled it (it prevents the default of the keys it uses)
      if (event.defaultPrevented) return;
      const shortcut = findAppShortcut(event, controller.isMac);
      if (!shortcut) return;
      if (controller.getSnapshot().dialog) return;
      const editable = (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if (editable && !shortcut.inInputs) return;
      event.preventDefault();
      void controller.run(shortcut.id);
    };
    window.addEventListener('keydown', onKeyDown);
    const flush = (): void => void controller.flushSession();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pagehide', flush);
    };
  }, [controller]);
}

export function Shell() {
  const controller = useController();
  const state = useAppState();
  useShellShortcuts();
  const { layout } = state;

  if (state.startupError) {
    return (
      <div className="startup" role="alert">
        <h1>The modeler could not start</h1>
        <pre>{state.startupError}</pre>
      </div>
    );
  }
  if (!state.ready) return <div className="startup" role="status">Loading…</div>;

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">Activiti Modeler</span>
        <MenuBar />
      </header>
      <div className="shell-main">
        {layout.explorerOpen && (
          <>
            <div className="side" style={{ width: layout.explorerWidth }}>
              <Explorer />
            </div>
            <Resizer orientation="vertical" direction={1} size={layout.explorerWidth} label="Resize the project explorer" testId="resize-explorer" onResize={(size, final) => {
              controller.setLayout({ explorerWidth: clamp(size, LAYOUT_LIMITS.explorerWidth) }, final);
            }} />
          </>
        )}
        <div className="center">
          <Workbench />
          <TabBar />
          <EditorArea />
          {layout.bottomOpen && (
            <>
              <Resizer orientation="horizontal" direction={-1} size={layout.bottomHeight} label="Resize the bottom panel" testId="resize-bottom" onResize={(size, final) => {
                controller.setLayout({ bottomHeight: clamp(size, LAYOUT_LIMITS.bottomHeight) }, final);
              }} />
              <div className="bottom" style={{ height: layout.bottomHeight }}>
                <BottomPanel />
              </div>
            </>
          )}
        </div>
        {layout.propertiesOpen && (
          <>
            <Resizer orientation="vertical" direction={-1} size={layout.propertiesWidth} label="Resize the properties panel" testId="resize-properties" onResize={(size, final) => {
              controller.setLayout({ propertiesWidth: clamp(size, LAYOUT_LIMITS.propertiesWidth) }, final);
            }} />
            <div className="side" style={{ width: layout.propertiesWidth }}>
              <PropertiesSlot />
            </div>
          </>
        )}
      </div>
      <StatusBar />
      <Toasts />
      <Dialogs />
      <ConnectionDialog />
      <DropZone />
      <PropertiesFocus />
    </div>
  );
}
