import { lossReportMarkdown, type ReportEntry } from '@activiti-modeler/activiti-project';
import { useState } from 'react';

import { t } from '../i18n';
import { useController } from '../state/context';
import type { DialogState } from '../state/types';
import { Modal } from './Dialogs';

const KINDS: Array<ReportEntry['kind']> = ['dropped', 'approximated', 'info'];
const KIND_KEYS = { dropped: 'camunda.kind.dropped', approximated: 'camunda.kind.approximated', info: 'camunda.kind.info' } as const;

/** The report of a Camunda 7 conversion (feature U17): what was dropped (element id, what, why), what differs, notes; can be saved as Markdown. */
export function LossReportDialog({ dialog }: { dialog: Extract<DialogState, { kind: 'lossReport' }> }) {
  const controller = useController();
  const { report, path } = dialog;
  const [showConverted, setShowConverted] = useState(false);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(lossReportMarkdown(report))
      .then(() => controller.toast(t('camunda.copied'), 'success'))
      .catch(() => controller.toast(t('camunda.failed'), 'error'));
  };
  return (
    <Modal title={t('camunda.reportTitle', { file: report.source })} onClose={() => controller.closeDialog()} wide testId="loss-report-dialog">
      <p data-testid="loss-report-summary">
        {t('camunda.reportSummary', { converted: report.counts.converted, dropped: report.counts.dropped, approximated: report.counts.approximated, info: report.counts.info })}
      </p>
      {report.general.map((note) => (
        <p key={note} className="muted" role="note">
          {note}
        </p>
      ))}
      {report.entries.length === 0 && <p className="muted">{t('camunda.reportNothing')}</p>}
      <div className="loss-report">
        {KINDS.map((kind) => {
          const entries = report.entries.filter((e) => e.kind === kind);
          if (entries.length === 0) return null;
          return (
            <section key={kind} data-kind={kind}>
              <h3>
                {t(KIND_KEYS[kind])} ({entries.length})
              </h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('camunda.element')}</th>
                    <th scope="col">{t('camunda.item')}</th>
                    <th scope="col">{t('camunda.what')}</th>
                    <th scope="col">{t('camunda.why')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, index) => (
                    <tr key={`${e.elementId}-${index}`} data-testid="loss-entry" data-element={e.elementId} data-kind={e.kind}>
                      <td>
                        <code>{e.elementId || '—'}</code>
                        {e.elementName ? <div className="muted small">{e.elementName}</div> : null}
                      </td>
                      <td>
                        <code>{e.item}</code>
                      </td>
                      <td>{e.what}</td>
                      <td>{e.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      {report.converted.length > 0 && (
        <details open={showConverted} onToggle={(event) => setShowConverted((event.target as HTMLDetailsElement).open)}>
          <summary>{t('camunda.showTranslated', { count: report.converted.length })}</summary>
          <ul className="loss-converted">
            {report.converted.map((c, index) => (
              <li key={index}>
                <code>{c.elementId}</code> <code>{c.from}</code> → <code>{c.to}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="button-row end">
        <button type="button" className="btn" onClick={copy} data-testid="loss-report-copy">
          {t('camunda.copy')}
        </button>
        <button type="button" className="btn primary" onClick={() => controller.saveLossReport(path)} data-testid="loss-report-save">
          {t('camunda.save')}
        </button>
        <button type="button" className="btn" onClick={() => controller.closeDialog()} data-testid="loss-report-close">
          {t('camunda.close')}
        </button>
      </div>
    </Modal>
  );
}
