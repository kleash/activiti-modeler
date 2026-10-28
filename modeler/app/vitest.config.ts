import { defineConfig } from 'vitest/config';

import { PATCHED_PACKAGES, thirdPartyPatches } from './patches.ts';

// The panel components are Preact (per-file `@jsxImportSource` pragma) and the package ships only the production JSX runtime.
export default defineConfig({
  plugins: [thirdPartyPatches()],
  oxc: { jsx: { development: false } },
  test: {
    testTimeout: 30_000,
    // inlined: @bpmn-io/variable-resolver ships ES modules in .js files without "type": "module"; the patched packages, so that the patches apply
    server: { deps: { inline: [/@bpmn-io\/variable-resolver/, ...PATCHED_PACKAGES] } },
  },
});
