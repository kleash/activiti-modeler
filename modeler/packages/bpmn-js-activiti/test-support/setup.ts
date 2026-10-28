import { installSvgPolyfills } from './jsdom-svg';

installSvgPolyfills();

// diagram-js measures text through a canvas in a few places; jsdom has none and logs "not implemented"
HTMLCanvasElement.prototype.getContext = (() => null) as never;
