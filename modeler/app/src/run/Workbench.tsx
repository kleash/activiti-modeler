import './run.css';

import { useEffect } from 'react';

import { t, type MessageKey } from '../i18n';
import { DeployTab } from './DeployTab';
import { useConnection, useRun } from './hooks';
import { InstancesTab } from './InstancesTab';
import { runService, type WorkbenchTab } from './runService';
import { ScenariosTab } from './ScenariosTab';
import { StartTab } from './StartTab';

const TABS: Array<{ id: WorkbenchTab; label: MessageKey }> = [
  { id: 'deploy', label: 'run.tab.deploy' },
  { id: 'start', label: 'run.tab.start' },
  { id: 'instances', label: 'run.tab.instances' },
  { id: 'scenarios', label: 'run.tab.scenarios' },
];

/**
 * The run workbench (features R2-R6): deploy the project to the connected modeler server, start instances, watch and act on them,
 * run scenarios. It covers the editor area while it is open; the editors stay mounted below it (their undo history is kept).
 */
export function Workbench() {
  const run = useRun();
  const conn = useConnection();
  useEffect(() => {
    if (!run.open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) runService.closeWorkbench();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run.open]);
  if (!run.open) return null;
  return (
    <section className="workbench" aria-label={t('run.workbench.label')} data-testid="workbench">
      <header className="workbench-header">
        <nav role="tablist" aria-label={t('run.workbench.views')} className="workbench-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={run.tab === tab.id} className={run.tab === tab.id ? 'selected' : ''} onClick={() => runService.setTab(tab.id)} data-testid={`run-tab-${tab.id}`}>
              {t(tab.label)}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => runService.openConnectionDialog()} data-testid="run-connection">
          {conn.status === 'connected' ? `${conn.user} @ ${conn.engine ? `Activiti ${conn.engine.activitiVersion}` : t('run.workbench.server')}` : t('run.workbench.connect')}
        </button>
        <button type="button" className="btn small" onClick={() => runService.closeWorkbench()} data-testid="run-close" title={t('run.workbench.closeTitle')}>
          {t('run.close')}
        </button>
      </header>
      {conn.status !== 'connected' ? <NotConnected /> : (
        <div className="workbench-body" role="tabpanel">
          {run.tab === 'deploy' && <DeployTab />}
          {run.tab === 'start' && <StartTab />}
          {run.tab === 'instances' && <InstancesTab />}
          {run.tab === 'scenarios' && <ScenariosTab />}
        </div>
      )}
    </section>
  );
}

function NotConnected() {
  const conn = useConnection();
  return (
    <div className="workbench-body empty" data-testid="not-connected">
      <h2>{t('run.workbench.notConnected')}</h2>
      <p className="muted">
        {t('run.workbench.needsServer')}{' '}
        <a href="https://github.com/kleash/activiti-modeler/blob/HEAD/docs/user-guide/install.md" target="_blank" rel="noreferrer">{t('run.workbench.installGuide')}</a> {t('run.workbench.installGuideHint')}
      </p>
      {conn.error && <p className="field-error">{conn.error}</p>}
      <button type="button" className="btn primary" onClick={() => runService.openConnectionDialog()} data-testid="not-connected-connect">
        {t('run.workbench.connectToServer')}
      </button>
    </div>
  );
}
