import { ErrorView } from '../editors/ErrorView';
import { useAppState, useController } from '../state/context';
import { getEditor } from '../state/editorRegistry';
import { Welcome } from './Welcome';

/**
 * Every open tab keeps its editor mounted (hidden when not active), so each keeps its undo history and canvas. A tab whose
 * editor failed shows the fail-safe error view instead.
 */
export function EditorArea() {
  const controller = useController();
  const state = useAppState();
  return (
    <div className="editor-area" data-testid="editor-area">
      {state.tabs.length === 0 && <Welcome />}
      {state.tabs.map((tab) => {
        const descriptor = getEditor(tab.editor);
        const active = tab.id === state.activeTabId;
        const Component = descriptor?.Component;
        return (
          <section key={tab.id} className={`editor-panel${active ? ' active' : ''}`} role="tabpanel" aria-label={tab.title} hidden={!active} data-path={tab.path}>
            {tab.error && <ErrorView tab={tab} openAsText={(path) => controller.openAsText(tab.id, path)} close={() => void controller.closeTab(tab.id)} />}
            {/* a failed editor stays mounted but invisible: the error view replaces it */}
            {Component ? (
              <div className="editor-host" style={{ display: tab.error ? 'none' : undefined }}>
                <Component tab={tab} host={controller.hostFor(tab.id)} active={active} />
              </div>
            ) : (
              <ErrorView tab={{ ...tab, error: { message: `No editor for ${tab.path}`, textFiles: [] } }} openAsText={() => undefined} close={() => void controller.closeTab(tab.id)} />
            )}
          </section>
        );
      })}
    </div>
  );
}
