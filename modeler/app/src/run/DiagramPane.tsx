import { BpmnDiagramViewer, type DiagramStructure, type ViewerOverlays } from '@activiti-modeler/activiti-diagram-viewer';
import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n';

export interface DiagramPaneProps {
  /** The BPMN XML to show; a new text loads a new diagram. */
  xml: string | undefined;
  /** What to draw; a function gets the structure of the loaded diagram (containers, event sub processes). */
  overlays: ViewerOverlays | ((structure: DiagramStructure) => ViewerOverlays);
  /** Element click: the element id, or undefined for the empty canvas. */
  onSelect?: (id: string | undefined) => void;
  selected?: string | undefined;
  /** Extra didi modules (token simulation). */
  additionalModules?: unknown[];
  testId?: string;
  /** The loaded viewer, for tests of the page and for extensions. */
  onViewer?: (viewer: BpmnDiagramViewer | undefined) => void;
}

/**
 * The read-only diagram of the run views: the viewer of `@activiti-modeler/activiti-diagram-viewer` with its overlays. The bpmn.io
 * watermark of the viewer stays visible (licence); nothing of the page may cover the bottom right corner of this pane.
 */
export function DiagramPane({ xml, overlays, onSelect, selected, additionalModules, testId = 'diagram-pane', onViewer }: DiagramPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<BpmnDiagramViewer | undefined>(undefined);
  const [loaded, setLoaded] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!host.current) return undefined;
    const viewer = new BpmnDiagramViewer({ container: host.current, ...(additionalModules ? { additionalModules } : {}), onElementClick: (id) => onSelectRef.current?.(id) });
    viewerRef.current = viewer;
    onViewer?.(viewer);
    const observer = new ResizeObserver(() => viewer.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      onViewer?.(undefined);
      viewer.destroy();
      viewerRef.current = undefined;
    };
    // the viewer belongs to the pane for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || xml === undefined) return;
    let cancelled = false;
    setError(undefined);
    viewer
      .load(xml)
      .then(() => {
        if (cancelled) return;
        setLoaded(xml);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [xml]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loaded === undefined || loaded !== xml) return;
    viewer.select(selected);
    const resolved = typeof overlays === 'function' ? overlays(viewer.structure()) : overlays;
    viewer.setOverlays(resolved);
  }, [overlays, loaded, xml, selected]);

  return (
    <div className="diagram-pane" data-testid={testId}>
      <div className="diagram-host activiti-viewer" ref={host} data-loaded={loaded !== undefined && loaded === xml ? 'true' : 'false'} data-testid={`${testId}-canvas`} />
      {error && (
        <p className="field-error diagram-error" role="alert">
          {t('run.diagram.error', { error })}
        </p>
      )}
      <div className="diagram-tools">
        <button type="button" className="btn small" onClick={() => viewerRef.current?.zoomBy(1.2)} aria-label={t('run.diagram.zoomIn')}>+</button>
        <button type="button" className="btn small" onClick={() => viewerRef.current?.zoomBy(1 / 1.2)} aria-label={t('run.diagram.zoomOut')}>-</button>
        <button type="button" className="btn small" onClick={() => viewerRef.current?.fit()} aria-label={t('run.diagram.fitLabel')}>{t('run.diagram.fit')}</button>
      </div>
    </div>
  );
}
