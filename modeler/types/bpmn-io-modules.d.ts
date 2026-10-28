// bpmn.io feature modules without bundled type declarations: they are didi modules, passed as `additionalModules`.

declare module 'diagram-js-minimap' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module 'diagram-js-grid' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module '@bpmn-io/align-to-origin' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module 'bpmn-js-native-copy-paste' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module 'bpmn-js-copy-as-image' {
  export const CopyAsImageModule: { __init__: string[]; [service: string]: unknown };
}

declare module '@bpmn-io/element-template-chooser' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module '@bpmn-io/element-template-chooser/dist/element-template-chooser.css';

declare module 'diagram-js-minimap/assets/diagram-js-minimap.css';
