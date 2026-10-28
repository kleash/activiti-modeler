// Modules of the DMN editor without bundled type declarations. The viewer and the shared style sheets are declared in run-modules.d.ts.

declare module 'dmn-js/lib/Modeler' {
  const Modeler: new (options?: object) => object;
  export default Modeler;
}

declare module 'dmn-js/dist/assets/dmn-js-boxed-expression.css';
declare module 'dmn-js/dist/assets/dmn-js-boxed-expression-controls.css';

declare module '@bpmn-io/dmn-migrate' {
  /** Migrates a DMN 1.1 or 1.2 document to DMN 1.3. */
  export function migrateDiagram(xml: string): Promise<string>;
}
