import type { Plugin } from 'vite';

/**
 * Fixes in third-party code, applied when the app is built (and in the unit tests). Each replacement must match exactly once, so an
 * upgrade that changes the code fails the build instead of dropping the fix silently.
 */
const PATCHES: Array<{ module: RegExp; why: string; replace: Array<[string, string]> }> = [
  {
    // bpmn-js-properties-panel 5.65.3 (and 6.0.1): the handlers of `elements.changed`, `propertiesPanel.providersChanged` and
    // `elementTemplates.changed` read the selected element of the last draw. One of those events between a selection change and the
    // next draw of the panel (a lint result, a catalog change or a command, on a busy machine) puts the previous element back, and the
    // panel keeps showing it. The handlers read the element the panel was last asked to show instead.
    module: /bpmn-js-properties-panel\/dist\/index\.esm\.js$/,
    why: 'the panel keeps the previous element after a quick selection change',
    replace: [
      ['  const selectedElement = state.selectedElement;\n', '  const selectedElement = state.selectedElement;\n  const [latest] = useState(() => ({ element }));\n'],
      ['    setState({\n      ...state,\n      selectedElement: newSelectedElement\n    });', '    latest.element = newSelectedElement;\n    setState({\n      ...state,\n      selectedElement: newSelectedElement\n    });'],
      ['findElement(elements, selectedElement)', 'findElement(elements, latest.element)'],
      ['    const onProvidersChanged = () => {\n      _update(selectedElement);', '    const onProvidersChanged = () => {\n      _update(latest.element);'],
      ['    const onTemplatesChanged = () => {\n      _update(selectedElement);', '    const onTemplatesChanged = () => {\n      _update(latest.element);'],
    ],
  },
];

/** The package names the patches apply to: the dev server must not pre-bundle them (pre-bundled code skips the plugins). */
export const PATCHED_PACKAGES = ['bpmn-js-properties-panel'];

export function thirdPartyPatches(): Plugin {
  return {
    name: 'third-party-patches',
    enforce: 'pre',
    transform(code, id) {
      const patch = PATCHES.find((p) => p.module.test(id.split('?')[0]!));
      if (!patch) return null;
      let out = code;
      for (const [from, to] of patch.replace) {
        const count = out.split(from).length - 1;
        if (count !== 1) throw new Error(`patch for ${id} (${patch.why}): expected the code to replace once, found it ${count} times: ${from}`);
        out = out.replace(from, to);
      }
      return { code: out, map: null };
    },
  };
}
