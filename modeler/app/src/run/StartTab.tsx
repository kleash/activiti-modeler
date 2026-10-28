import { useEffect, useMemo, useState } from 'react';

import { t } from '../i18n';
import { useController } from '../state/context';
import { connection } from './connection';
import { useConnection, usePolled, useRun } from './hooks';
import { recorder } from './recorder';
import { errorMessage, runService } from './runService';
import { VariablesEditor } from './VariablesEditor';
import { rowsForProperties, variablesWithoutDefaults, type VariableRow } from './variables';

type Mode = 'process' | 'message';

/** Start an instance (R3): the process picker, a business key, typed variables from the process' declared properties, or a start by message. */
export function StartTab() {
  const run = useRun();
  const conn = useConnection();
  const controller = useController();
  const defs = usePolled(() => connection.require().listProcessDefinitions({ latest: true, size: 200 }), `defs:${conn.status}:${run.deployment?.deploymentId ?? ''}`, 0);
  const [mode, setMode] = useState<Mode>('process');
  const [key, setKey] = useState<string>(run.startKey ?? '');
  const [messageName, setMessageName] = useState('');
  const [businessKey, setBusinessKey] = useState('');
  const [rows, setRows] = useState<VariableRow[]>([]);
  const [defaults, setDefaults] = useState<VariableRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const items = useMemo(() => defs.data?.items ?? [], [defs.data]);
  // the preset from "Start..." in the deploy tab, else the first process
  useEffect(() => {
    if (run.startKey) setKey(run.startKey);
  }, [run.startKey]);
  useEffect(() => {
    if (!key && items[0]) setKey(items[0].key);
  }, [items, key]);

  // typed variables from the declared properties of the chosen process (the extensions file of its deployment)
  const extensions = usePolled(async () => {
    if (!key) return undefined;
    const client = connection.require();
    const definition = items.find((p) => p.key === key);
    try {
      // ask only when the deployment has the extensions file of the process: a request that ends in 404 is a console error in the browser
      if (definition) {
        const base = definition.resourceName.replace(/\.(bpmn20\.xml|bpmn)$/, '');
        const resources = await client.listDeploymentResources(definition.deploymentId);
        if (!resources.some((r) => r.name === `${base}-extensions.json`)) return undefined;
      }
      return (await client.getProcessDefinitionExtensions(key)).extensions;
    } catch {
      return undefined; // a process without an extensions entry declares nothing
    }
  }, `ext:${key}:${run.deployment?.deploymentId ?? ''}:${items.length}`, 0, key !== '' && items.length > 0);
  useEffect(() => {
    if (extensions.loading) return;
    const declared = rowsForProperties(extensions.data);
    setDefaults(declared);
    setRows(declared);
    setErrors({});
  }, [extensions.data, extensions.loading, key]);

  const selected = useMemo(() => items.find((p) => p.key === key), [items, key]);
  const canStart = mode === 'process' ? key !== '' : messageName.trim() !== '';

  const start = async (): Promise<void> => {
    const { variables, errors: found } = variablesWithoutDefaults(rows, defaults);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const request = {
        ...(mode === 'process' ? { processKey: key } : { messageName: messageName.trim() }),
        ...(businessKey.trim() ? { businessKey: businessKey.trim() } : {}),
        ...(Object.keys(variables).length > 0 ? { variables } : {}),
      };
      if (record) recorder.begin();
      const instance = await connection.require().startProcessInstance(request);
      if (record && conn.user) {
        recorder.noteStart({
          instanceId: instance.id,
          ...(mode === 'process' ? { process: key } : { message: messageName.trim() }),
          ...(businessKey.trim() ? { businessKey: businessKey.trim() } : {}),
          ...(Object.keys(variables).length > 0 ? { variables } : {}),
          user: conn.user,
        });
      }
      controller.toast(t('run.start.started', { id: instance.id.slice(0, 8), process: instance.processDefinitionKey, user: conn.user ?? '' }), 'success');
      runService.showInstance(instance.id);
    } catch (e) {
      if (record) recorder.discard();
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="run-pane" data-testid="start-tab">
      <div className="run-toolbar">
        <label className="radio">
          <input type="radio" name="start-mode" checked={mode === 'process'} onChange={() => setMode('process')} data-testid="start-mode-process" /> {t('run.start.byProcess')}
        </label>
        <label className="radio">
          <input type="radio" name="start-mode" checked={mode === 'message'} onChange={() => setMode('message')} data-testid="start-mode-message" /> {t('run.start.byMessage')}
        </label>
        <span className="muted">{t('run.start.startsAs', { user: conn.user ?? t('run.start.signedInUser') })}</span>
      </div>
      {defs.error && <p className="field-error">{defs.error}</p>}
      {mode === 'process' ? (
        <label className="field wide">
          <span>{t('run.start.process')}</span>
          <select value={key} onChange={(e) => setKey(e.target.value)} data-testid="start-process">
            {items.length === 0 && <option value="">{t('run.start.nothingDeployed')}</option>}
            {items.map((p) => (
              <option key={p.id} value={p.key}>
                {p.key}{p.name ? ` - ${p.name}` : ''} ({t('run.version', { version: p.version })})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field wide">
          <span>{t('run.start.messageName')}</span>
          <input value={messageName} onChange={(e) => setMessageName(e.target.value)} placeholder={t('run.start.messagePlaceholder')} spellCheck={false} data-testid="start-message" />
        </label>
      )}
      <label className="field wide">
        <span>{t('run.start.businessKey')}</span>
        <input value={businessKey} onChange={(e) => setBusinessKey(e.target.value)} placeholder={t('run.start.optional')} spellCheck={false} data-testid="start-business-key" />
      </label>
      <label className="field wide checkbox">
        <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} data-testid="start-record" />
        <span>{t('run.start.record')}</span>
      </label>
      <h3>{t('run.start.variables')}</h3>
      <p className="muted">
        {mode === 'process' && selected
          ? defaults.length > 0
            ? t('run.start.declared')
            : t('run.start.noneDeclared')
          : t('run.start.messageVariables')}
      </p>
      <VariablesEditor rows={rows} onChange={setRows} errors={errors} testId="start-variables" />
      {failure && (
        <p className="field-error" role="alert" data-testid="start-error">
          {failure}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="btn primary" disabled={!canStart || busy} onClick={() => void start()} data-testid="start-button">
          {busy ? t('run.start.starting') : t('run.start.start')}
        </button>
      </div>
    </div>
  );
}
