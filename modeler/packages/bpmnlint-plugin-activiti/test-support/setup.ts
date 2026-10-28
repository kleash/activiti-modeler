import { installSvgPolyfills } from '../../bpmn-js-activiti/test-support/jsdom-svg';

// only the jsdom tests (the editor module) need the SVG layout stand-ins
if (typeof document !== 'undefined') {
  installSvgPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}
