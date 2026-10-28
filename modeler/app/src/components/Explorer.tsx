import { buildTree, classifyFile, type TreeNode } from '@activiti-modeler/activiti-project';
import { type KeyboardEvent, useMemo, useState } from 'react';

import { useAppState, useController } from '../state/context';

const ICONS: Record<string, string> = { bpmn: '◇', dmn: '▦', extensions: '{ }', scenario: '▶', connector: '⚙', other: '·' };

interface RowProps {
  node: TreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  toggle(path: string): void;
  selected: string | undefined;
  select(path: string): void;
  dirty: ReadonlySet<string>;
  openPaths: ReadonlySet<string>;
  activePath: string | undefined;
  menu(path: string, x: number, y: number): void;
}

function Row({ node, depth, collapsed, toggle, selected, select, dirty, openPaths, activePath, menu }: RowProps) {
  const controller = useController();
  const isFolder = node.type === 'folder';
  const isCollapsed = collapsed.has(node.path);
  const open = (): void => {
    if (isFolder) toggle(node.path);
    else controller.openTab(node.path);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter') open();
    else if (event.key === 'F2' && !isFolder) void controller.renameFile(node.path);
    else if (event.key === 'Delete' && !isFolder) void controller.deleteFile(node.path);
  };
  const kind = isFolder ? 'folder' : classifyFile(node.path);
  return (
    <>
      <li role="none">
        <button
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={isFolder ? !isCollapsed : undefined}
          aria-selected={selected === node.path}
          data-path={node.path}
          data-kind={kind}
          className={`tree-row${selected === node.path ? ' selected' : ''}${activePath === node.path ? ' current' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            select(node.path);
            if (isFolder) toggle(node.path);
          }}
          onDoubleClick={() => !isFolder && controller.openTab(node.path)}
          onKeyDown={onKeyDown}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!isFolder) {
              select(node.path);
              menu(node.path, event.clientX, event.clientY);
            }
          }}
        >
          <span className="tree-icon" aria-hidden="true">
            {isFolder ? (isCollapsed ? '▸' : '▾') : (ICONS[kind] ?? '·')}
          </span>
          <span className="tree-name">{node.name}</span>
          {!isFolder && dirty.has(node.path) && <span className="dirty-dot" role="img" aria-label="unsaved changes" title="Unsaved changes" />}
          {!isFolder && openPaths.has(node.path) && !dirty.has(node.path) && <span className="open-dot" aria-hidden="true" />}
        </button>
      </li>
      {isFolder && !isCollapsed && node.children.map((child) => <Row key={child.path} {...{ node: child, depth: depth + 1, collapsed, toggle, selected, select, dirty, openPaths, activePath, menu }} />)}
    </>
  );
}

/** The project explorer: the files of the project as a tree, with new / rename / delete (feature U1). */
export function Explorer() {
  const controller = useController();
  const state = useAppState();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | undefined>();
  const project = state.project;
  const tree = useMemo(() => buildTree(project?.paths ?? []), [project?.paths]);
  const activePath = state.tabs.find((t) => t.id === state.activeTabId)?.path;
  const openPaths = useMemo(() => new Set(state.tabs.map((t) => t.path)), [state.tabs]);

  const toggle = (path: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <aside className="explorer" aria-label="Project explorer" data-testid="explorer">
      <div className="panel-header">
        <button type="button" className="project-name" title={`${project?.label ?? ''}: switch or open a project`} onClick={() => void controller.run('openProject')} data-testid="project-name">
          {project?.name ?? 'No project'}
        </button>
        <button type="button" className="icon-button" aria-label="New file" title="New file (from a template)" onClick={() => void controller.run('newFile')} data-testid="new-file">
          +
        </button>
      </div>
      <ul role="tree" aria-label="Project files" className="tree" data-testid="file-tree">
        {tree.map((node) => (
          <Row key={node.path} {...{ node, depth: 0, collapsed, toggle, selected, select: setSelected, dirty: project?.dirtyPaths ?? new Set(), openPaths, activePath, menu: (path: string, x: number, y: number) => setContextMenu({ path, x, y }) }} />
        ))}
      </ul>
      {contextMenu && (
        <div className="context-menu-backdrop" onClick={() => setContextMenu(undefined)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(undefined); }}>
          <ul role="menu" className="menu-list context" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {[
              ['Open', () => controller.openTab(contextMenu.path)],
              ['Rename…', () => void controller.renameFile(contextMenu.path)],
              ['Delete…', () => void controller.deleteFile(contextMenu.path)],
            ].map(([label, run]) => (
              <li key={label as string} role="none">
                <button type="button" role="menuitem" className="menu-item" onClick={() => (run as () => void)()}>
                  <span className="menu-label">{label as string}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
