import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

// `window.__modelerTestApi` exists in dev builds and in builds made with VITE_MODELER_TEST_API=true (the Playwright
// run). The condition is replaced at build time, so a normal production bundle contains none of it.
if (import.meta.env.DEV || import.meta.env.VITE_MODELER_TEST_API === 'true') {
  const { installTestApi } = await import('./testApi');
  installTestApi();
  const { installLintTestHook } = await import('./lint/testHook');
  installLintTestHook();
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
