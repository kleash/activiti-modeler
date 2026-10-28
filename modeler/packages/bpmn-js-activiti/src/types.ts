import type { ModdleElement } from 'bpmn-moddle';

export type { ModdleElement };

/** The parts of a diagram-js element that the Activiti modules use. */
export interface DiagramElement {
  id: string;
  type: string;
  businessObject: ModdleElement;
  parent?: DiagramElement | null;
  children?: DiagramElement[];
  host?: DiagramElement | null;
  attachers?: DiagramElement[];
  source?: DiagramElement | null;
  target?: DiagramElement | null;
  incoming?: DiagramElement[];
  outgoing?: DiagramElement[];
  labelTarget?: DiagramElement | null;
  label?: DiagramElement | null;
  waypoints?: Array<{ x: number; y: number }>;
  x: number;
  y: number;
  width: number;
  height: number;
  di?: ModdleElement;
}

export type ElementRef = DiagramElement | string;

export interface CommandStack {
  execute(command: string, context: Record<string, unknown>): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  registerHandler(command: string, handler: new (...args: never[]) => unknown): void;
}

export interface Modeling {
  updateProperties(element: DiagramElement, properties: Record<string, unknown>): void;
  updateModdleProperties(element: DiagramElement, moddleElement: ModdleElement, properties: Record<string, unknown>): void;
  updateLabel(element: DiagramElement, text: string): void;
  createShape(shape: unknown, position: { x: number; y: number }, target: DiagramElement | null, hints?: Record<string, unknown>): DiagramElement;
  appendShape(source: DiagramElement, shape: unknown, position: { x: number; y: number }, target?: DiagramElement, hints?: Record<string, unknown>): DiagramElement;
  connect(source: DiagramElement, target: DiagramElement, attrs?: Record<string, unknown>, hints?: Record<string, unknown>): DiagramElement;
  removeElements(elements: DiagramElement[]): void;
  moveElements(elements: DiagramElement[], delta: { x: number; y: number }, target?: DiagramElement): void;
}

export interface ElementRegistry {
  get(id: string): DiagramElement | undefined;
  getAll(): DiagramElement[];
  filter(fn: (element: DiagramElement) => boolean): DiagramElement[];
  forEach(fn: (element: DiagramElement) => void): void;
}

export interface BpmnFactory {
  create<T extends ModdleElement = ModdleElement>(type: string, attrs?: Record<string, unknown>): T;
}

export interface Canvas {
  getRootElement(): DiagramElement;
  addMarker(element: DiagramElement | string, marker: string): void;
}

export function isBusinessObject(value: unknown): value is ModdleElement {
  return typeof value === 'object' && value !== null && '$type' in value;
}

/** Business object of a diagram element, or the element itself when it already is one. */
export function businessObjectOf(element: DiagramElement | ModdleElement): ModdleElement {
  return 'businessObject' in element && element.businessObject ? (element.businessObject as ModdleElement) : (element as ModdleElement);
}

export const is = (element: DiagramElement | ModdleElement | undefined | null, type: string): boolean =>
  !!element && businessObjectOf(element).$instanceOf(type);

export const isAny = (element: DiagramElement | ModdleElement | undefined | null, types: readonly string[]): boolean =>
  types.some((type) => is(element, type));
