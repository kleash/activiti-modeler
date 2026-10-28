import { svgToImage } from '@bpmn-io/svg-to-image';

/**
 * An SVG document as a PNG blob.
 *
 * `svgToImage` can hand the image over as a blob, but then it asks the canvas for `toBlob`, which Chromium encodes in an idle task of
 * the page; on a machine whose cores are all busy (parallel e2e workers, a loaded laptop) that task starves and the callback comes
 * 6 to 7 seconds late, so "copy as image" and the PNG export hang for that long. The data URL is encoded at once (`toDataURL` is
 * synchronous), and the blob is made from its bytes here.
 */
export async function svgToPngBlob(svg: string): Promise<Blob> {
  const dataUrl = await svgToImage(svg, { imageType: 'png', outputFormat: 'dataUrl' });
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/** The renderer of bpmn-js-copy-as-image, as far as the page uses it. */
interface ElementsRenderer {
  renderAsPNG(elements: unknown[]): Promise<Blob>;
  renderAsSVG(elements: unknown[]): Promise<string>;
}

/** Makes "copy selection as image" encode through `svgToPngBlob`; see there. */
class PngViaDataUrl {
  static $inject = ['elementsRenderer'];
  constructor(elementsRenderer: ElementsRenderer) {
    elementsRenderer.renderAsPNG = async (elements) => svgToPngBlob(await elementsRenderer.renderAsSVG(Array.isArray(elements) ? elements : [elements]));
  }
}

export const PngViaDataUrlModule = { __init__: ['pngViaDataUrl'], pngViaDataUrl: ['type', PngViaDataUrl] };
