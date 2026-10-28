import { useState } from 'react';

import { t } from '../i18n';
import { connection } from './connection';
import { usePolled, useRun } from './hooks';
import { InstanceView } from './InstanceView';
import { runService } from './runService';

type StateFilter = 'all' | 'running' | 'finished';

const LIVE_MS = 1500;

export const stateClass = (state: string): string => `state state-${state.toLowerCase()}`;

/** The instance list and the instance view (R4, R5), refreshed by polling. */
export function InstancesTab() {
  const run = useRun();
  const [filter, setFilter] = useState<StateFilter>('all');
  const [keyFilter, setKeyFilter] = useState('');
  const list = usePolled(
    () => connection.require().listProcessInstances({ state: filter, size: 100, ...(keyFilter ? { definitionKey: keyFilter } : {}) }),
    `instances:${filter}:${keyFilter}`,
    LIVE_MS,
  );
  const items = [...(list.data?.items ?? [])].sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''));
  const selected = run.selectedInstanceId;
  return (
    <div className="instances" data-testid="instances-tab">
      <aside className="instance-list" aria-label={t('run.instances.label')}>
        <div className="run-toolbar">
          <select value={filter} onChange={(e) => setFilter(e.target.value as StateFilter)} aria-label={t('run.instances.show')} data-testid="instances-filter">
            <option value="all">{t('run.instances.all')}</option>
            <option value="running">{t('run.instances.running')}</option>
            <option value="finished">{t('run.instances.finished')}</option>
          </select>
          <input value={keyFilter} onChange={(e) => setKeyFilter(e.target.value.trim())} placeholder={t('run.instances.keyPlaceholder')} aria-label={t('run.instances.keyFilter')} spellCheck={false} data-testid="instances-key-filter" />
        </div>
        {list.error && <p className="field-error">{list.error}</p>}
        {!list.loading && items.length === 0 && <p className="muted pad">{t('run.instances.none')}</p>}
        <ul className="instance-rows" data-testid="instance-list">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" className={`instance-row${i.id === selected ? ' selected' : ''}`} onClick={() => runService.showInstance(i.id)} data-testid={`instance-${i.id}`} data-state={i.state}>
                <span className="key">{i.processDefinitionKey}</span>
                <span className={stateClass(i.state)}>{i.state}</span>
                <span className="muted small">
                  {i.id.slice(0, 8)}
                  {i.businessKey ? ` - ${i.businessKey}` : ''}
                  {i.superProcessInstanceId ? t('run.instances.child') : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="instance-detail">{selected ? <InstanceView id={selected} /> : <p className="muted pad">{t('run.instances.select')}</p>}</div>
    </div>
  );
}
