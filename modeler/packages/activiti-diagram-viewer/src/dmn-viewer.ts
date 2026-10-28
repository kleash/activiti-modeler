import 'dmn-js/dist/assets/diagram-js.css';
import 'dmn-js/dist/assets/dmn-js-shared.css';
import 'dmn-js/dist/assets/dmn-js-drd.css';
import 'dmn-js/dist/assets/dmn-js-decision-table.css';
import 'dmn-js/dist/assets/dmn-js-decision-table-controls.css';
import 'dmn-js/dist/assets/dmn-js-literal-expression.css';
import 'dmn-js/dist/assets/dmn-font/css/dmn-embedded.css';
import './viewer.css';

import DmnViewer from 'dmn-js/lib/Viewer';

export interface DmnViewerOptions {
  container: HTMLElement;
}

export interface DmnView {
  id: string;
  name?: string;
  type: 'drd' | 'decisionTable' | 'literalExpression' | string;
}

interface RawView {
  type: string;
  element: { id: string; name?: string };
}

interface RawViewer {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  getViews(): RawView[];
  open(view: RawView): Promise<{ warnings: unknown[] }>;
  getActiveView(): RawView | undefined;
  destroy(): void;
}

/**
 * A read-only DMN viewer (dmn-js `Viewer`): the decision requirements diagram and the decision tables / literal expressions of a DMN
 * file, and the rows a decision matched. A host page can use it to show a deployed decision next to its process.
 * dmn-js keeps its "powered by bpmn.io" logo in the diagram views.
 */
export class DmnDiagramViewer {
  private readonly viewer: RawViewer;
  private views: RawView[] = [];
  private matched: string[] = [];

  constructor(private readonly options: DmnViewerOptions) {
    options.container.classList.add('activiti-dmn-viewer');
    this.viewer = new DmnViewer({ container: options.container } as never) as unknown as RawViewer;
  }

  /** Shows a DMN file: the table of `decisionId` when given, else the first view that is not the DRD. */
  async load(xml: string, decisionId?: string): Promise<{ warnings: string[]; views: DmnView[] }> {
    const result = await this.viewer.importXML(xml);
    this.views = this.viewer.getViews();
    const wanted = decisionId ? this.views.find((v) => v.element.id === decisionId) : this.views.find((v) => v.type !== 'drd') ?? this.views[0];
    if (wanted) await this.viewer.open(wanted);
    return { warnings: result.warnings.map((w) => (w as { message?: string }).message ?? String(w)), views: this.listViews() };
  }

  listViews(): DmnView[] {
    return this.views.map((v) => ({ id: v.element.id, ...(v.element.name ? { name: v.element.name } : {}), type: v.type }));
  }

  /** Opens another view of the loaded file (a decision by id). */
  async open(decisionId: string): Promise<void> {
    const view = this.views.find((v) => v.element.id === decisionId);
    if (!view) throw new Error(`The DMN file has no decision ${decisionId}`);
    await this.viewer.open(view);
    this.highlightRules(this.matched);
  }

  /** Marks the rows of the open decision table whose rule id is listed (the `matchedRules` of a decision evaluation). */
  highlightRules(ruleIds: readonly string[]): void {
    this.matched = [...ruleIds];
    const rows = this.options.container.querySelectorAll<HTMLElement>('tr[data-row-id]');
    rows.forEach((row) => row.classList.toggle('activiti-rule-matched', this.matched.includes(row.dataset['rowId'] ?? '')));
  }

  destroy(): void {
    this.viewer.destroy();
  }
}
