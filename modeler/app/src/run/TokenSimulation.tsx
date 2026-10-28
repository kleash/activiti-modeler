import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';

import { BpmnDiagramViewer } from '@activiti-modeler/activiti-diagram-viewer';
import TokenSimulationModule from 'bpmn-js-token-simulation/lib/viewer';
import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n';
import { useLint } from '../lint/useLint';
import { gateExplanation, simulationGate } from './simulationGate';

interface XmlSource {
  saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>;
}

/** May this file be simulated (U16), and if not, why. Follows the live lint of the file. */
export function useSimulationGate(path: string): { allowed: boolean; explanation: string } {
  const lint = useLint();
  const gate = simulationGate(lint.problems, path);
  return { allowed: gate.allowed, explanation: gateExplanation(gate) };
}

/**
 * Token simulation (U16) over the diagram of the editor: a read-only copy of the diagram (the editor and its undo history are not touched)
 * in a viewer with the bpmn-js token simulation, switched on. Gateways ask which way to go, timers and events can be triggered, the log
 * lists what happened. The bpmn.io watermark of the viewer stays visible.
 */
export function SimulationPane({ modeler, onClose }: { modeler: XmlSource; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return undefined;
    const viewer = new BpmnDiagramViewer({ container: host.current, additionalModules: [TokenSimulationModule] });
    let disposed = false;
    void (async () => {
      try {
        const { xml } = await modeler.saveXML({ format: true });
        if (disposed || xml === undefined) return;
        await viewer.load(xml);
        if (disposed) return;
        (viewer.raw.get('toggleMode') as { toggleMode(active: boolean): void }).toggleMode(true);
        setReady(true);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    const observer = new ResizeObserver(() => viewer.resize());
    observer.observe(host.current);
    return () => {
      disposed = true;
      observer.disconnect();
      viewer.destroy();
    };
  }, [modeler]);
  return (
    <div className="simulation-pane" data-testid="simulation-pane" data-ready={String(ready)}>
      <div className="simulation-bar">
        <strong>{t('run.simulation.title')}</strong>
        <span className="muted small">{t('run.simulation.hint')}</span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onClose} data-testid="simulation-close">{t('run.simulation.back')}</button>
      </div>
      {error && <p className="field-error" role="alert">{t('run.simulation.error', { error })}</p>}
      <div className="simulation-canvas activiti-viewer" ref={host} data-testid="simulation-canvas" />
    </div>
  );
}
