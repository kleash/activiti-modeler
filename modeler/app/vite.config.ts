import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { PATCHED_PACKAGES, thirdPartyPatches } from './patches.ts';

export default defineConfig({
  plugins: [thirdPartyPatches(), react()],
  optimizeDeps: { exclude: PATCHED_PACKAGES },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    // bpmn-js and its CSS/fonts make the single bundle large; code-splitting comes with the editor features.
    chunkSizeWarningLimit: 1000,
  },
});
