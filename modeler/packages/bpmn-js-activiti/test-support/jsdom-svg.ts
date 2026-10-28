/**
 * jsdom has no SVG layout. bpmn-js/diagram-js only need plausible geometry from these calls,
 * so this installs small stand-ins (text width is estimated from the string length).
 */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

class Matrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  multiply(m: Matrix): Matrix {
    const r = new Matrix();
    r.a = this.a * m.a + this.c * m.b;
    r.b = this.b * m.a + this.d * m.b;
    r.c = this.a * m.c + this.c * m.d;
    r.d = this.b * m.c + this.d * m.d;
    r.e = this.a * m.e + this.c * m.f + this.e;
    r.f = this.b * m.e + this.d * m.f + this.f;
    return r;
  }
  inverse(): Matrix {
    return new Matrix();
  }
  translate(x: number, y: number): Matrix {
    const m = new Matrix();
    m.e = x;
    m.f = y;
    return this.multiply(m);
  }
  scale(s: number): Matrix {
    const m = new Matrix();
    m.a = s;
    m.d = s;
    return this.multiply(m);
  }
}

class Transform {
  matrix = new Matrix();
  setMatrix(m: Matrix): void {
    this.matrix = m;
  }
  setTranslate(x: number, y: number): void {
    this.matrix = new Matrix().translate(x, y);
  }
  setScale(sx: number): void {
    this.matrix = new Matrix().scale(sx);
  }
  setRotate(): void {}
}

function bboxOf(el: Element): Box {
  const tag = el.localName;
  if (tag === 'text' || tag === 'tspan') {
    const len = (el.textContent ?? '').length;
    return { x: 0, y: 0, width: len * 7, height: len ? 14 : 0 };
  }
  const num = (name: string): number => Number(el.getAttribute(name) ?? 0) || 0;
  if (tag === 'rect' || tag === 'image') return { x: num('x'), y: num('y'), width: num('width'), height: num('height') };
  if (tag === 'circle') return { x: num('cx') - num('r'), y: num('cy') - num('r'), width: num('r') * 2, height: num('r') * 2 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of Array.from(el.children)) {
    const b = bboxOf(child);
    if (b.width === 0 && b.height === 0) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return minX === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function installSvgPolyfills(): void {
  const win = window as unknown as Record<string, { prototype: Record<string, unknown> }>;
  const svgElement = win['SVGElement']?.prototype;
  const svgSvg = win['SVGSVGElement']?.prototype;
  if (!svgElement || !svgSvg) throw new Error('jsdom environment required');
  (globalThis as Record<string, unknown>)['SVGMatrix'] = Matrix;
  svgElement['getBBox'] = function (this: Element): Box {
    return bboxOf(this);
  };
  svgElement['getComputedTextLength'] = function (this: Element): number {
    return (this.textContent ?? '').length * 7;
  };
  svgElement['getCTM'] = () => new Matrix();
  svgElement['getScreenCTM'] = () => new Matrix();
  svgSvg['createSVGMatrix'] = () => new Matrix();
  svgSvg['createSVGTransform'] = () => new Transform();
  svgSvg['createSVGTransformFromMatrix'] = (m: Matrix) => {
    const t = new Transform();
    t.setMatrix(m);
    return t;
  };
  svgSvg['createSVGPoint'] = () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
  Object.defineProperty(svgElement, 'transform', {
    configurable: true,
    get(this: { __transform?: { baseVal: unknown } }) {
      this.__transform ??= {
        baseVal: {
          numberOfItems: 0,
          clear() {},
          appendItem() {},
          consolidate: () => ({ matrix: new Matrix() }),
          getItem: () => new Transform(),
        },
      };
      return this.__transform;
    },
  });
}
