import { getFillColor, getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { append as svgAppend, attr as svgAttr, create as svgCreate } from 'tiny-svg';

import { DMN_DECISION_IMPLEMENTATION } from '../../support-matrix';
import type { DiagramElement } from '../../types';
import { templateIconKind, templateLinkOf } from '../templates/templates';

interface BpmnRendererLike {
  handlers: Record<string, (parent: SVGElement, element: DiagramElement, attrs?: Record<string, unknown>) => SVGElement>;
}
interface EventBusLike {
  on(event: string, priority: number, handler: (event: never) => void): void;
}

const PRIORITY = 1400;
const FILL = 'white';
const STROKE = 'black';

export type TaskKind = 'decision' | 'mail' | 'shell' | 'connector' | 'class' | 'expression' | 'delegateExpression';

/** What the renderer draws for a task, from its Activiti implementation. */
export function taskKindOf(element: Pick<DiagramElement, 'businessObject'>): TaskKind | undefined {
  const bo = element.businessObject;
  if (!bo) return undefined;
  if (bo.$instanceOf('bpmn:ServiceTask')) {
    if (bo.get('implementation') === DMN_DECISION_IMPLEMENTATION) return 'decision';
    const type = bo.get('activiti:type');
    if (type === 'mail' || type === 'shell') return type;
    // a task created from an element template wears the icon of its template
    const link = templateLinkOf(bo);
    if (link) return templateIconKind(link.id);
  }
  return undefined;
}

const ICONS: Record<TaskKind, Array<{ d: string; fill?: boolean }>> = {
  // decision table: frame, two rows and a column divider
  decision: [{ d: 'M0,0 h16 v12 h-16 z' }, { d: 'M0,4 h16 M0,8 h16 M6,0 v12' }, { d: 'M0,0 h16 v4 h-16 z', fill: true }],
  mail: [{ d: 'M0,0 h16 v11 h-16 z' }, { d: 'M0,0 l8,6 l8,-6' }],
  shell: [{ d: 'M0,0 h16 v12 h-16 z' }, { d: 'M3,3 l4,3 l-4,3' }, { d: 'M9,9 h4' }],
  // a plug: two pins, the body and the cable
  connector: [{ d: 'M4,0 v3 M12,0 v3' }, { d: 'M1,3 h14 v3 a7,5 0 0 1 -14,0 z' }, { d: 'M8,11 v2' }],
  // curly braces
  class: [{ d: 'M5,0 c-3,0 -1,5 -3,6 c2,1 0,6 3,6' }, { d: 'M11,0 c3,0 1,5 3,6 c-2,1 0,6 -3,6' }],
  // f(x)
  expression: [{ d: 'M1,12 c3,0 3,-12 6,-12 M1,6 h6' }, { d: 'M9,4 l6,7 M15,4 l-6,7' }],
  // a hash: the #{bean} of a delegate expression
  delegateExpression: [{ d: 'M5,0 l-2,12 M11,0 l-2,12 M1,4 h13 M0,8 h13' }],
};

/**
 * Draws the Activiti flavours of a service task: a decision table icon for the DMN decision task, an envelope for mail
 * and a terminal for shell, and the icon of the element template a task was created from (a plug for a connector action,
 * braces for a Java class, f(x) for an expression, a hash for a delegate expression), instead of the generic gear.
 * Everything else is left to bpmn-js.
 */
export class ActivitiRenderer extends BaseRenderer {
  static $inject = ["eventBus", "bpmnRenderer"];

  private readonly bpmnRenderer: BpmnRendererLike;

  constructor(eventBus: EventBusLike, bpmnRenderer: BpmnRendererLike) {
    super(eventBus as never, PRIORITY);
    this.bpmnRenderer = bpmnRenderer;
  }

  override canRender(element: DiagramElement): boolean {
    return taskKindOf(element) !== undefined && !element.labelTarget;
  }

  override drawShape(parentGfx: SVGElement, element: DiagramElement): SVGElement {
    const kind = taskKindOf(element)!;
    // a plain task: rectangle, label and markers, without the gear
    const task = this.bpmnRenderer.handlers['bpmn:Task']!(parentGfx, element, {});
    const fill = getFillColor(element as never, FILL) as string;
    const stroke = getStrokeColor(element as never, STROKE) as string;
    const icon = svgCreate('g');
    svgAttr(icon, { transform: 'translate(8, 8)', class: `activiti-task-icon activiti-task-${kind}` });
    for (const part of ICONS[kind]) {
      const path = svgCreate('path');
      svgAttr(path, { d: part.d, fill: part.fill ? stroke : fill === 'white' ? 'none' : fill, stroke, 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'fill-opacity': part.fill ? 0.18 : 1 });
      svgAppend(icon, path);
    }
    svgAppend(parentGfx, icon);
    return task;
  }
}

export const RendererModule = {
  __init__: ['activitiRenderer'],
  activitiRenderer: ['type', ActivitiRenderer],
};
