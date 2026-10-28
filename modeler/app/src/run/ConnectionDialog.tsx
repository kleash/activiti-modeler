import { type FormEvent, useState } from 'react';

import { Modal } from '../components/Dialogs';
import { t } from '../i18n';
import { connection, displayUrl } from './connection';
import { useConnection, useRun } from './hooks';
import { runService } from './runService';

/** Connection settings (R1): the server's URL, the user and the password, with a test that reports what the server is. */
export function ConnectionDialog() {
  const run = useRun();
  if (!run.connectionDialog) return null;
  return <ConnectionForm />;
}

function ConnectionForm() {
  const state = useConnection();
  const [baseUrl, setBaseUrl] = useState(state.settings.baseUrl);
  const [username, setUsername] = useState(state.settings.username);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(state.settings.rememberPassword);
  const close = (): void => runService.closeConnectionDialog();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const ok = await connection.connect({ baseUrl, username: username.trim(), rememberPassword: remember }, password);
    if (ok) close();
  };

  return (
    <Modal title={t('run.connection.title')} onClose={close} testId="connection-dialog">
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>{t('run.connection.url')}</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('run.connection.urlPlaceholder', { url: displayUrl('') })} spellCheck={false} data-testid="connection-url" />
        </label>
        <p className="muted">{t('run.connection.urlHelp')}</p>
        <label className="field">
          <span>{t('run.connection.user')}</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} data-testid="connection-user" />
        </label>
        <label className="field">
          <span>{t('run.connection.password')}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="connection-password" />
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="connection-remember" />
          <span>{t('run.connection.remember')}</span>
        </label>
        <p className="muted">{t('run.connection.demoUsers')}</p>
        {state.status === 'connected' && state.engine && (
          <p className="notice ok" data-testid="connection-current">
            {t('run.connection.connected', { user: state.user ?? '', version: state.engine.activitiVersion })}
          </p>
        )}
        {state.error && (
          <p className="field-error" role="alert" data-testid="connection-error">
            {state.error}
          </p>
        )}
        <div className="button-row end">
          {state.status === 'connected' && (
            <button type="button" className="btn" onClick={() => connection.disconnect()} data-testid="connection-disconnect">
              {t('run.connection.signOut')}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            {t('run.close')}
          </button>
          <button type="submit" className="btn primary" disabled={state.busy} data-testid="connection-connect">
            {state.busy ? t('run.connection.connecting') : t('run.connection.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The server in the status bar (R1): who is connected to what, and whether the async executor runs. */
export function ServerStatus() {
  const state = useConnection();
  const text = connection.summary();
  const detail = state.engine
    ? t('run.server.detail', {
        activiti: state.engine.activitiVersion,
        springBoot: state.engine.springBootVersion,
        java: state.engine.javaVersion,
        history: state.engine.historyLevel ?? '?',
        dmn: state.engine.dmn.available ? (state.engine.dmn.engine ?? t('run.server.dmnAvailable')) : t('run.server.dmnUnavailable'),
        executor: state.engine.asyncExecutor.active ? t('run.server.executorRunning') : t('run.server.executorOff'),
      })
    : t('run.server.unreachable', { reason: state.error ?? t('run.server.notContacted') });
  return (
    <button type="button" className={`status-button server-status ${state.status}`} onClick={() => runService.openConnectionDialog()} title={detail} data-testid="status-server" data-status={state.status}>
      <span className="server-dot" aria-hidden="true" />
      {text}
    </button>
  );
}
