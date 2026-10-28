// Modules of the run/test features without bundled type declarations.

declare module 'dmn-js/lib/Viewer' {
  const Viewer: new (options?: object) => object;
  export default Viewer;
}

declare module 'dmn-js/dist/assets/diagram-js.css';
declare module 'dmn-js/dist/assets/dmn-js-shared.css';
declare module 'dmn-js/dist/assets/dmn-js-drd.css';
declare module 'dmn-js/dist/assets/dmn-js-decision-table.css';
declare module 'dmn-js/dist/assets/dmn-js-decision-table-controls.css';
declare module 'dmn-js/dist/assets/dmn-js-literal-expression.css';
declare module 'dmn-js/dist/assets/dmn-font/css/dmn-embedded.css';

declare module 'bpmn-js-token-simulation/lib/viewer' {
  const module: { __depends__: unknown[] };
  export default module;
}

declare module 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
declare module 'bpmn-js/dist/assets/diagram-js.css';
declare module 'bpmn-js/dist/assets/bpmn-js.css';
