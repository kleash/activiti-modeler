import { classifyFile } from '@activiti-modeler/activiti-project';

import { t } from '../i18n';
import { useController } from '../state/context';
import { useRun, useScenarioResults } from './hooks';
import { runService } from './runService';
import { ScenarioReportView } from './ScenarioReportView';

/** The scenarios of the project (R6): run one or all of them on the server and read the report. */
export function ScenariosTab() {
  const controller = useController();
  const run = useRun();
  const results = useScenarioResults();
  const workspace = controller.workspace;
  const files = (workspace?.model.paths() ?? []).filter((p) => classifyFile(p) === 'scenario').sort();
  const selected = run.scenarioPath && files.includes(run.scenarioPath) ? run.scenarioPath : files[0];
  const record = selected ? results.records.get(selected) : undefined;
  return (
    <div className="scenarios" data-testid="scenarios-tab">
      <aside className="scenario-files">
        <div className="run-toolbar">
          <button type="button" className="btn small primary" disabled={files.length === 0 || results.busy} onClick={() => void runService.runAllScenarios()} data-testid="scenarios-run-all">
            {t('run.scenarios.runAll')}
          </button>
          <span className="muted small">{t(files.length === 1 ? 'run.scenarios.files.one' : 'run.scenarios.files.other', { count: files.length })}</span>
        </div>
        {files.length === 0 && (
          <p className="muted pad">
            {t('run.scenarios.none')} <code>scenarios/&lt;name&gt;.scenario.json</code> {t('run.scenarios.noneHint')}
          </p>
        )}
        <ul className="instance-rows">
          {files.map((path) => {
            const r = results.records.get(path);
            const status = r?.running ? 'running' : r?.response ? (r.response.passed ? 'passed' : 'failed') : r?.error ? 'error' : 'none';
            const label = { running: t('run.scenarios.status.running'), passed: t('run.scenarios.status.passed'), failed: t('run.scenarios.status.failed'), error: t('run.scenarios.status.error'), none: '' }[status];
            return (
              <li key={path}>
                <div className={`instance-row scenario-file${path === selected ? ' selected' : ''}`} data-testid={`scenario-file-${path.replace(/^.*\//, '')}`} data-status={status}>
                  <button type="button" className="link name" onClick={() => runService.showScenario(path)}>{path.replace(/^scenarios\//, '')}</button>
                  <span className={`state state-${status === 'passed' ? 'completed' : status === 'failed' || status === 'error' ? 'cancelled' : 'suspended'}`}>{label}</span>
                  <span className="actions">
                    <button type="button" className="btn small" disabled={results.busy} onClick={() => { runService.showScenario(path); void runService.runScenario(path); }} data-testid={`scenario-run-${path.replace(/^.*\//, '')}`}>
                      {t('run.scenarios.run')}
                    </button>{' '}
                    <button type="button" className="btn small" onClick={() => { runService.closeWorkbench(); void controller.openTab(path); }}>{t('run.scenarios.edit')}</button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="scenario-result">
        {record ? <ScenarioReportView record={record} workspace={workspace} /> : <p className="muted pad">{t('run.scenarios.select')}</p>}
      </div>
    </div>
  );
}
