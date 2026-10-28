import { useEffect, useState } from 'react';

import { Shell } from './components/Shell';
import { registerBuiltinEditors } from './editors';
import { lintService } from './lint/LintService';
import { connection } from './run/connection';
import { registerRunEditors } from './run/registerRunEditors';
import { runService } from './run/runService';
import { AppController } from './state/controller';
import { ControllerContext } from './state/context';

registerBuiltinEditors();
registerRunEditors();

export function App() {
  // one controller for the life of the page (React StrictMode mounts twice in development)
  const [controller] = useState(() => new AppController());
  useEffect(() => {
    void controller.init();
  }, [controller]);
  // the lint of the project follows the app state (files, tabs) and opens files and shows toasts through the controller
  useEffect(() => {
    lintService.bind({ workspace: () => controller.workspace, openFile: (path) => void controller.openTab(path), toast: (m, k, d) => controller.toast(m, k, d) });
    lintService.onAppChange();
    return controller.subscribe(() => lintService.onAppChange());
  }, [controller]);
  // the run side (connection, deploy, scenarios) acts on the open project through the controller
  useEffect(() => {
    runService.bind({
      workspace: () => controller.workspace,
      saveAll: () => controller.saveAll(),
      toast: (m, k, d) => controller.toast(m, k, d),
      askChoice: (options) => controller.askChoice(options),
      openFile: (path) => void controller.openTab(path),
      showBottomPanel: () => {
        if (!controller.getSnapshot().layout.bottomOpen) void controller.run('toggleBottom');
        lintService.showProblems();
      },
    });
    void connection.init();
    return () => connection.stop();
  }, [controller]);
  return (
    <ControllerContext.Provider value={controller}>
      <Shell />
    </ControllerContext.Provider>
  );
}
