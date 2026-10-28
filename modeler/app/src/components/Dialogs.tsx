import { TEMPLATES } from '@activiti-modeler/activiti-project';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { availableLocales, t } from '../i18n';
import { useAppState, useController } from '../state/context';
import { formatCombo, type ShortcutGroup, SHORTCUTS } from '../state/shortcuts';
import type { DialogState } from '../state/types';
import { LossReportDialog } from './LossReportDialog';

export function Modal({ title, onClose, children, wide, testId }: { title: string; onClose(): void; children: React.ReactNode; wide?: boolean; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = ref.current?.querySelector<HTMLElement>('input, button.primary, button.btn, button');
    focusable?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId ?? 'dialog'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PromptDialog({ dialog }: { dialog: Extract<DialogState, { kind: 'prompt' }> }) {
  const controller = useController();
  const [value, setValue] = useState(dialog.initial);
  const error = dialog.validate?.(value);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!error) controller.answerDialog(dialog.id, value);
  };
  return (
    <Modal title={dialog.title} onClose={() => controller.closeDialog()}>
      <form onSubmit={submit}>
        <label className="field">
          <span>{dialog.label}</span>
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} spellCheck={false} aria-invalid={!!error} aria-describedby="prompt-help" data-testid="prompt-input" />
        </label>
        <p id="prompt-help" className={error ? 'field-error' : 'muted'} role={error ? 'alert' : undefined} data-testid="prompt-help">
          {error ?? dialog.hint ?? ''}
        </p>
        <div className="button-row end">
          <button type="button" className="btn" onClick={() => controller.closeDialog()}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!!error} data-testid="prompt-confirm">
            {dialog.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ChoiceDialog({ dialog }: { dialog: Extract<DialogState, { kind: 'choice' }> }) {
  const controller = useController();
  return (
    <Modal title={dialog.title} onClose={() => controller.closeDialog()} testId="choice-dialog">
      <p>{dialog.message}</p>
      {dialog.detail && <p className="muted">{dialog.detail}</p>}
      <div className="button-row end">
        {dialog.choices.map((choice) => (
          <button key={choice.id} type="button" className={`btn${choice.primary ? ' primary' : ''}${choice.danger ? ' danger' : ''}`} onClick={() => controller.answerDialog(dialog.id, choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function AlertDialog({ dialog }: { dialog: Extract<DialogState, { kind: 'alert' }> }) {
  const controller = useController();
  return (
    <Modal title={dialog.title} onClose={() => controller.closeDialog()} testId="alert-dialog" wide>
      <p role="alert" className="alert-message">
        {dialog.message}
      </p>
      {dialog.detail && <pre className="error-detail">{dialog.detail}</pre>}
      <div className="button-row end">
        <button type="button" className="btn primary" onClick={() => controller.closeDialog()}>
          {t('dialog.ok')}
        </button>
      </div>
    </Modal>
  );
}

const GROUP_ORDER: ShortcutGroup[] = ['File', 'Edit', 'Tools', 'View', 'Navigation'];

function ShortcutsDialog() {
  const controller = useController();
  return (
    <Modal title={t('shortcuts.title')} onClose={() => controller.closeDialog()} wide testId="shortcuts-dialog">
      <p className="muted">
        {controller.isMac ? t('shortcuts.introMac') : t('shortcuts.introOther')} {t('shortcuts.introKeys')}
      </p>
      <div className="shortcut-grid">
        {GROUP_ORDER.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <table>
              <tbody>
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td className="keys">
                      {s.keys.map((k) => (
                        <kbd key={k}>{formatCombo(k, controller.isMac)}</kbd>
                      ))}
                      {s.browserReserved ? ' *' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <div className="button-row end">
        <button type="button" className="btn primary" onClick={() => controller.closeDialog()}>
          {t('dialog.close')}
        </button>
      </div>
    </Modal>
  );
}

function SettingsDialog() {
  const controller = useController();
  const state = useAppState();
  const settings = state.settings;
  const check = (key: 'autoLayout' | 'restoreSession' | 'offerCamundaConversion', label: string) => (
    <label className="check-row">
      <input type="checkbox" checked={settings[key]} onChange={(event) => controller.setSettings({ [key]: event.target.checked })} data-testid={`setting-${key}`} />
      <span>{label}</span>
    </label>
  );
  return (
    <Modal title={t('settings.title')} onClose={() => controller.closeDialog()} wide testId="settings-dialog">
      <p className="muted">{t('settings.intro')}</p>
      <fieldset className="settings-group">
        <legend>{t('settings.editing')}</legend>
        <div role="radiogroup" aria-label={t('settings.defaultMappings')} className="settings-radios">
          <span className="settings-label">{t('settings.defaultMappings')}</span>
          <label className="check-row">
            <input type="radio" name="defaultMappings" checked={settings.defaultMappings === 'mapAll'} onChange={() => controller.setSettings({ defaultMappings: 'mapAll' })} data-testid="setting-defaultMappings-mapAll" />
            <span>{t('settings.mapAll')}</span>
          </label>
          <label className="check-row">
            <input type="radio" name="defaultMappings" checked={settings.defaultMappings === 'none'} onChange={() => controller.setSettings({ defaultMappings: 'none' })} data-testid="setting-defaultMappings-none" />
            <span>{t('settings.mapNone')}</span>
          </label>
        </div>
        {check('autoLayout', t('settings.autoLayout'))}
        {check('offerCamundaConversion', t('settings.offerCamunda'))}
      </fieldset>
      <fieldset className="settings-group">
        <legend>{t('settings.workspace')}</legend>
        {check('restoreSession', t('settings.restoreSession'))}
        <div className="settings-row">
          <button type="button" className="btn" onClick={() => void controller.run('resetLayout').then(() => controller.toast(t('settings.resetLayoutDone'), 'success'))} data-testid="setting-reset-layout">
            {t('settings.resetLayout')}
          </button>
          <span className="muted">{t('settings.resetLayoutHelp')}</span>
        </div>
        <label className="field">
          <span>{t('settings.language')}</span>
          <select value={settings.locale} onChange={(event) => controller.setSettings({ locale: event.target.value })} data-testid="setting-locale">
            {availableLocales().map((code) => (
              <option key={code} value={code}>
                {code === 'en' ? 'English' : code}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{t('settings.languageHelp')}</p>
      </fieldset>
      <div className="button-row end">
        <button type="button" className="btn" onClick={() => controller.restoreDefaultSettings()} data-testid="setting-restore-defaults">
          {t('settings.restoreDefaults')}
        </button>
        <button type="button" className="btn primary" onClick={() => controller.closeDialog()}>
          {t('settings.close')}
        </button>
      </div>
    </Modal>
  );
}

function TemplatesDialog() {
  const controller = useController();
  return (
    <Modal title={t('templates.title')} onClose={() => controller.closeDialog()} wide testId="templates-dialog">
      <ul className="template-list">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button type="button" className="template" data-testid={`template-${t.id}`} onClick={() => void controller.newFromTemplate(t.id)}>
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row end">
        <button type="button" className="btn" onClick={() => controller.closeDialog()}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Modal>
  );
}

function ProjectsDialog() {
  const controller = useController();
  const state = useAppState();
  const fileInput = useRef<HTMLInputElement>(null);
  const existing = new Set(state.projects.map((p) => `idb:${p.name}`));
  // most recently opened first; a browser project that was deleted is no longer offered
  const recent = state.recent.filter((r) => r.kind !== 'indexeddb' || existing.has(r.key)).slice(0, 8);
  return (
    <Modal title={t('projects.title')} onClose={() => controller.closeDialog()} wide testId="projects-dialog">
      {recent.length > 0 && (
        <>
          <h3>{t('projects.recent')}</h3>
          <ol className="project-list recent" data-testid="recent-list">
            {recent.map((r) => (
              <li key={r.key}>
                <button type="button" className="project-open" onClick={() => void controller.openRecent(r)} aria-current={state.project?.key === r.key}>
                  <strong>{r.name}</strong>
                  <span className="muted">{r.kind === 'indexeddb' ? t('projects.browser') : r.kind === 'fs-access' ? t('projects.folder') : t('projects.server')}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      <h3>{t('projects.all')}</h3>
      {state.projects.length === 0 ? (
        <p className="muted">{t('projects.none')}</p>
      ) : (
        <ul className="project-list" data-testid="project-list">
          {state.projects.map((p) => (
            <li key={p.name}>
              <button type="button" className="project-open" onClick={() => void controller.openProject(p.name)} aria-current={state.project?.key === `idb:${p.name}`}>
                <strong>{p.name}</strong>
                <span className="muted">{state.project?.key === `idb:${p.name}` ? t('projects.open') : new Date(p.modified).toLocaleString()}</span>
              </button>
              <button type="button" className="btn danger small" aria-label={t('projects.deleteLabel', { name: p.name })} onClick={() => void controller.deleteProject(p.name)}>
                {t('projects.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button type="button" className="btn primary" onClick={() => void controller.newProject()}>
          {t('projects.new')}
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          {t('projects.importZip')}
        </button>
        <button type="button" className="btn" disabled={!state.folderSupported} title={state.folderSupported ? '' : t('projects.folderUnsupported')} onClick={() => void controller.openLocalFolder()}>
          {t('projects.openFolder')}
        </button>
        <button type="button" className="btn" onClick={() => void controller.openServerWorkspace()}>
          {t('projects.openServer')}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="projects-zip-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void file.arrayBuffer().then((buffer) => controller.importZipData(new Uint8Array(buffer), file.name));
        }}
      />
      <div className="button-row end">
        <button type="button" className="btn" onClick={() => controller.closeDialog()}>
          {t('dialog.close')}
        </button>
      </div>
    </Modal>
  );
}

/** The one modal dialog that is open, if any. */
export function Dialogs() {
  const state = useAppState();
  const dialog = state.dialog;
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'prompt':
      return <PromptDialog key={dialog.id} dialog={dialog} />;
    case 'choice':
      return <ChoiceDialog key={dialog.id} dialog={dialog} />;
    case 'alert':
      return <AlertDialog key={dialog.id} dialog={dialog} />;
    case 'shortcuts':
      return <ShortcutsDialog key={dialog.id} />;
    case 'settings':
      return <SettingsDialog key={dialog.id} />;
    case 'templates':
      return <TemplatesDialog key={dialog.id} />;
    case 'projects':
      return <ProjectsDialog key={dialog.id} />;
    case 'lossReport':
      return <LossReportDialog key={dialog.id} dialog={dialog} />;
  }
}
