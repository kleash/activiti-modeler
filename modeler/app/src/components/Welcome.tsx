import { TEMPLATES } from '@activiti-modeler/activiti-project';

import { t } from '../i18n';
import { useAppState, useController } from '../state/context';

/** Shown when no file is open. */
export function Welcome() {
  const controller = useController();
  const state = useAppState();
  return (
    <div className="welcome" data-testid="welcome">
      <h1>{t('welcome.title')}</h1>
      <p>{t('welcome.hint')}</p>
      <div className="button-row">
        {TEMPLATES.slice(0, 4).map((tpl) => (
          <button key={tpl.id} type="button" className="btn" onClick={() => void controller.newFromTemplate(tpl.id)}>
            {t('welcome.newFrom', { template: tpl.label.toLowerCase() })}
          </button>
        ))}
      </div>
      {state.closedCount > 0 && (
        <p>
          <button type="button" className="link" onClick={() => controller.reopenClosed()}>
            {t('welcome.reopen')}
          </button>
        </p>
      )}
    </div>
  );
}
