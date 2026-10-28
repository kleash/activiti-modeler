import { useEffect, useState, useSyncExternalStore } from 'react';

import { ProblemsPanel } from '../lint/ProblemsPanel';
import { useLint } from '../lint/useLint';
import { bottomTabRequest, subscribeBottomTab } from '../state/bottomTab';
import { useAppState } from '../state/context';
import { t } from '../i18n';
import { VariablesPanel } from '../variables/VariablesPanel';

type PanelTab = 'warnings' | 'problems' | 'variables';

/**
 * The bottom panel: the Problems of the project (feature U11) and the warnings of imports and exports (feature U25).
 * Toggle with Cmd/Ctrl+B.
 */
export function BottomPanel() {
  const state = useAppState();
  const lint = useLint();
  const [tab, setTab] = useState<PanelTab>('warnings');
  const request = useSyncExternalStore(subscribeBottomTab, bottomTabRequest);
  useEffect(() => {
    if (request.serial > 0) setTab(request.tab);
  }, [request]);
  // a click on the status bar counters, or a deploy attempt, asks for the Problems tab
  useEffect(() => {
    if (lint.showRequest > 0) setTab('problems');
  }, [lint.showRequest]);
  const withWarnings = state.tabs.filter((t) => t.warnings.length > 0);
  const total = withWarnings.reduce((n, t) => n + t.warnings.length, 0);
  return (
    <section className="bottom-panel" aria-label="Bottom panel" data-testid="bottom-panel">
      <div className="panel-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'warnings'} className={tab === 'warnings' ? 'selected' : ''} onClick={() => setTab('warnings')} data-testid="warnings-tab">
          Import warnings{total > 0 ? ` (${total})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'problems'} className={tab === 'problems' ? 'selected' : ''} onClick={() => setTab('problems')} data-testid="problems-tab">
          Problems{lint.problems.length > 0 ? ` (${lint.problems.length})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'variables'} className={tab === 'variables' ? 'selected' : ''} onClick={() => setTab('variables')} data-testid="variables-tab">
          {t('variables.tab')}
        </button>
      </div>
      <div className={`panel-body${tab === 'problems' || tab === 'variables' ? ' panel-body--flush' : ''}`} role="tabpanel">
        {tab === 'warnings' &&
          (total === 0 ? (
            <p className="muted">No import or export warnings.</p>
          ) : (
            withWarnings.map((t) => (
              <div key={t.id} className="warning-group">
                <h3>{t.path}</h3>
                <ul data-testid="warning-list">
                  {t.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ))
          ))}
        {tab === 'problems' && <ProblemsPanel />}
        {tab === 'variables' && <VariablesPanel />}
      </div>
    </section>
  );
}
