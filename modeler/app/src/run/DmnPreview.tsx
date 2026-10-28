import { DmnDiagramViewer } from '@activiti-modeler/activiti-diagram-viewer';
import { useEffect, useRef, useState } from 'react';

import { Modal } from '../components/Dialogs';
import { t } from '../i18n';
import { connection } from './connection';
import { errorMessage } from './runService';

/** A deployed decision, read-only (the DMN viewer of the diagram viewer package). */
export function DmnPreview({ deploymentId, resource, decisionId, matchedRules, onClose }: { deploymentId: string | undefined; resource: string; decisionId: string; matchedRules?: string[]; onClose(): void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (!container.current || !deploymentId) return undefined;
    const viewer = new DmnDiagramViewer({ container: container.current });
    let disposed = false;
    void (async () => {
      try {
        const xml = await connection.require().getDeploymentResource(deploymentId, resource);
        const result = await viewer.load(xml, decisionId);
        if (disposed) return;
        setWarnings(result.warnings);
        if (matchedRules) viewer.highlightRules(matchedRules);
      } catch (e) {
        if (!disposed) setError(errorMessage(e));
      }
    })();
    return () => {
      disposed = true;
      viewer.destroy();
    };
  }, [deploymentId, resource, decisionId, matchedRules]);
  return (
    <Modal title={t('run.dmn.title', { id: decisionId })} onClose={onClose} wide testId="dmn-preview">
      {error && <p className="field-error" role="alert">{error}</p>}
      {warnings.length > 0 && <p className="muted">{t('run.dmn.warnings', { count: warnings.length })}</p>}
      <div className="dmn-preview-host" ref={container} data-testid="dmn-preview-host" />
      <div className="button-row end">
        <button type="button" className="btn primary" onClick={onClose}>{t('run.close')}</button>
      </div>
    </Modal>
  );
}
