import { isProjectTextFile } from '@activiti-modeler/activiti-project';
import { useEffect } from 'react';

import { useAppState, useController } from '../state/context';

const hasFiles = (event: DragEvent): boolean => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');

/** Drag and drop of files or a project zip onto the page (feature U26). */
export function DropZone() {
  const controller = useController();
  const state = useAppState();

  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      controller.setDropActive(true);
    };
    const over = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) controller.setDropActive(false);
    };
    const drop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      controller.setDropActive(false);
      void handleDrop(Array.from(event.dataTransfer?.files ?? []));
    };
    const handleDrop = async (files: File[]): Promise<void> => {
      const zips = files.filter((f) => /\.zip$/i.test(f.name) || f.type === 'application/zip');
      const texts = files.filter((f) => !zips.includes(f));
      if (zips.length > 0) {
        if (zips.length > 1 || texts.length > 0) controller.toast('A project zip was dropped: only the first zip is imported, drop other files separately', 'info');
        await controller.importZipData(new Uint8Array(await zips[0]!.arrayBuffer()), zips[0]!.name);
        return;
      }
      const accepted = texts.filter((f) => isProjectTextFile(f.name));
      const rejected = texts.filter((f) => !accepted.includes(f));
      if (rejected.length > 0) controller.toast(`Skipped ${rejected.length} file(s) that are not project files`, 'error', rejected.map((f) => f.name).join('\n'));
      if (accepted.length > 0) await controller.importFiles(await Promise.all(accepted.map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [controller]);

  if (!state.dropActive) return null;
  return (
    <div className="drop-overlay" data-testid="drop-overlay" aria-hidden="true">
      <div>Drop files or a project zip to import</div>
    </div>
  );
}
