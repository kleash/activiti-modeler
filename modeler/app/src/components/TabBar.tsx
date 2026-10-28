import { t } from '../i18n';
import { useAppState, useController } from '../state/context';

/** One tab per open file, with a marker for unsaved changes and a close button (feature U1). */
export function TabBar() {
  const controller = useController();
  const state = useAppState();
  return (
    <div className="tab-bar" role="tablist" aria-label={t('tab.openFiles')} data-testid="tab-bar">
      {state.tabs.map((tab) => (
        <div key={tab.id} className={`tab${tab.id === state.activeTabId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`} data-testid={`tab-${tab.title}`}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === state.activeTabId}
            className="tab-title"
            title={`${tab.path}${tab.dirty ? t('tab.unsaved') : ''}`}
            onClick={() => {
              controller.activateTab(tab.id);
              controller.focusActive();
            }}
            onAuxClick={(event) => event.button === 1 && void controller.closeTab(tab.id)}
          >
            {tab.error && <span className="tab-error" role="img" aria-label="could not be opened" title="Could not be opened">!</span>}
            <span className="tab-label">{tab.title}</span>
            {tab.dirty && <span className="dirty-dot" role="img" aria-label="unsaved changes" />}
          </button>
          <button type="button" className="tab-close" aria-label={`Close ${tab.title}`} onClick={() => void controller.closeTab(tab.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
