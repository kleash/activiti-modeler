import { TEMPLATES } from '@activiti-modeler/activiti-project';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { t } from '../i18n';
import { runService } from '../run/runService';
import { useAppState, useController } from '../state/context';
import type { AppController } from '../state/controller';
import { shortcutLabel } from '../state/shortcuts';
import type { AppSnapshot } from '../state/types';

export interface MenuItem {
  label: string;
  shortcut?: string | undefined;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  children?: MenuItem[];
  testId?: string;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

const sep: MenuItem = { label: '', separator: true };

/** The menus of the app. Pure of React so that tests can look at what each menu offers. */
export function buildMenus(controller: AppController, state: AppSnapshot, fileInput: () => void): Menu[] {
  const mac = controller.isMac;
  const sc = (id: string): string | undefined => shortcutLabel(id, mac);
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  // the DMN editor (dmn-js) answers the same edit and view commands as the BPMN editor (undo, redo, find and zoom in the DRD)
  const bpmnTab = !!tab && (tab.editor === 'bpmn' || tab.editor === 'dmn') && !tab.error;
  const diagram = bpmnTab && tab.view === 'diagram';
  const selection = diagram ? (controller.activeTab?.handle?.selectionCount?.() ?? 0) : 0;
  const cmd = (id: string) => (): void => void controller.run(id);

  return [
    {
      label: t('menu.file'),
      items: [
        { label: t('menu.newFile'), shortcut: sc('newFile'), children: TEMPLATES.map((t) => ({ label: t.label, run: () => void controller.newFromTemplate(t.id), testId: `template-${t.id}` })) },
        { label: t('menu.newProject'), run: cmd('newProject') },
        { label: t('menu.openProject'), shortcut: sc('openProject'), run: cmd('openProject') },
        { label: t('menu.openLocalFolder'), run: cmd('openFolder'), disabled: !state.folderSupported },
        { label: t('menu.openServerWorkspace'), run: cmd('openServer') },
        { label: t('menu.importProjectZip'), run: fileInput },
        { label: t('menu.exportProjectAsZip'), run: cmd('exportZip'), disabled: !state.project },
        sep,
        { label: t('menu.save'), shortcut: sc('save'), run: cmd('save'), disabled: !tab },
        { label: t('menu.saveAs'), shortcut: sc('saveAs'), run: cmd('saveAs'), disabled: !tab },
        { label: t('menu.saveAll'), shortcut: sc('saveAll'), run: cmd('saveAll'), disabled: !state.project },
        sep,
        { label: t('camunda.menu.convert'), run: cmd('convertCamunda'), disabled: !diagram, testId: 'menu-convert-camunda' },
        { label: t('camunda.menu.report'), run: cmd('showLossReport'), disabled: !tab || !state.lossReportPaths.includes(tab.path), testId: 'menu-camunda-report' },
        sep,
        { label: t('menu.exportDiagramAsSvg'), run: cmd('exportSvg'), disabled: !diagram },
        { label: t('menu.exportDiagramAsPng'), run: cmd('exportPng'), disabled: !diagram },
        sep,
        { label: t('menu.closeTab'), shortcut: sc('closeTab'), run: cmd('closeTab'), disabled: !tab },
        { label: t('menu.reopenLastClosedTab'), shortcut: sc('reopenClosed'), run: cmd('reopenClosed'), disabled: state.closedCount === 0 },
        { label: t('menu.nextTab'), shortcut: sc('nextTab'), run: cmd('nextTab'), disabled: state.tabs.length < 2 },
        { label: t('menu.previousTab'), shortcut: sc('prevTab'), run: cmd('prevTab'), disabled: state.tabs.length < 2 },
        sep,
        { label: t('settings.menu'), shortcut: sc('openSettings'), run: cmd('openSettings'), testId: 'menu-settings' },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        // the extensions JSON shares the undo stack of the diagram (ADR 0006), so undo and redo work in every view of a process
        { label: t('menu.undo'), shortcut: sc('undo'), run: cmd('undo'), disabled: !bpmnTab },
        { label: t('menu.redo'), shortcut: sc('redo'), run: cmd('redo'), disabled: !bpmnTab },
        sep,
        { label: t('menu.cut'), shortcut: sc('cut'), run: cmd('cut'), disabled: !diagram },
        { label: t('menu.copy'), shortcut: sc('copy'), run: cmd('copy'), disabled: !diagram },
        { label: t('menu.paste'), shortcut: sc('paste'), run: cmd('paste'), disabled: !diagram },
        { label: t('menu.duplicate'), shortcut: sc('duplicate'), run: cmd('duplicate'), disabled: !diagram },
        { label: t('menu.delete'), shortcut: 'Del', run: cmd('removeSelection'), disabled: !diagram },
        { label: t('menu.selectAll'), shortcut: sc('selectAll'), run: cmd('selectAll'), disabled: !diagram },
        sep,
        { label: t('menu.findElement'), shortcut: sc('find'), run: cmd('find'), disabled: !diagram },
        { label: t('menu.createElement'), shortcut: sc('createElement'), run: cmd('createElement'), disabled: !diagram, testId: 'menu-create-element' },
        { label: t('menu.appendElement'), shortcut: sc('appendElement'), run: cmd('appendElement'), disabled: !diagram, testId: 'menu-append-element' },
        {
          label: t('menu.alignElements'),
          disabled: selection < 2,
          children: [
            { label: t('menu.alignLeft'), run: cmd('alignLeft') },
            { label: t('menu.alignCenter'), run: cmd('alignCenter') },
            { label: t('menu.alignRight'), run: cmd('alignRight') },
            { label: t('menu.alignTop'), run: cmd('alignTop') },
            { label: t('menu.alignMiddle'), run: cmd('alignMiddle') },
            { label: t('menu.alignBottom'), run: cmd('alignBottom') },
          ],
        },
        {
          label: t('menu.distributeElements'),
          disabled: selection < 3,
          children: [
            { label: t('menu.distributeHorizontally'), run: cmd('distributeHorizontally') },
            { label: t('menu.distributeVertically'), run: cmd('distributeVertically') },
          ],
        },
        { label: t('menu.moveDiagramToOrigin'), shortcut: sc('moveToOrigin'), run: cmd('moveToOrigin'), disabled: !diagram },
        { label: t('menu.copySelectionAsImage'), shortcut: sc('copyAsImage'), run: cmd('copyAsImage'), disabled: selection < 1 },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { label: t('menu.zoomIn'), shortcut: sc('zoomIn'), run: cmd('zoomIn'), disabled: !diagram },
        { label: t('menu.zoomOut'), shortcut: sc('zoomOut'), run: cmd('zoomOut'), disabled: !diagram },
        { label: t('menu.actualSize'), shortcut: sc('zoomActual'), run: cmd('zoomActual'), disabled: !diagram },
        { label: t('menu.fitDiagram'), shortcut: sc('zoomFit'), run: cmd('zoomFit'), disabled: !diagram },
        sep,
        { label: t('menu.projectExplorer'), run: cmd('toggleExplorer'), checked: state.layout.explorerOpen },
        { label: t('menu.propertiesPanel'), shortcut: sc('toggleProperties'), run: cmd('toggleProperties'), checked: state.layout.propertiesOpen },
        { label: t('menu.bottomPanel'), shortcut: sc('toggleBottom'), run: cmd('toggleBottom'), checked: state.layout.bottomOpen },
        { label: t('menu.variables'), run: cmd('showVariables'), disabled: !diagram, testId: 'menu-variables' },
        { label: t('menu.resetPropertiesPanel'), shortcut: sc('resetProperties'), run: cmd('resetProperties') },
        { label: t('settings.resetLayout'), run: cmd('resetLayout'), testId: 'menu-reset-layout' },
        sep,
        { label: t('menu.minimap'), run: cmd('toggleMinimap'), checked: state.layout.minimapOpen, disabled: !diagram },
        { label: t('menu.grid'), run: cmd('toggleGrid'), checked: state.layout.gridVisible, disabled: !diagram },
      ],
    },
    {
      label: t('menu.run'),
      items: [
        { label: t('menu.connectToServer'), run: () => runService.openConnectionDialog(), testId: 'menu-connect' },
        sep,
        { label: t('menu.deployProject'), run: () => void runService.deploy(), disabled: !state.project, testId: 'menu-deploy' },
        { label: t('menu.startInstance'), run: () => runService.startForm(), testId: 'menu-start' },
        { label: t('menu.instances'), run: () => runService.openWorkbench('instances'), testId: 'menu-instances' },
        sep,
        { label: t('menu.scenarios'), run: () => runService.openWorkbench('scenarios'), testId: 'menu-scenarios' },
        { label: t('menu.runAllScenarios'), run: () => { runService.openWorkbench('scenarios'); void runService.runAllScenarios(); }, disabled: !state.project, testId: 'menu-run-scenarios' },
        sep,
        { label: t('menu.closeRunView'), run: () => runService.closeWorkbench(), testId: 'menu-close-run' },
      ],
    },
    { label: t('menu.help'), items: [{ label: t('menu.keyboardShortcuts'), run: cmd('showShortcuts') }] },
  ];
}

function MenuList({ items, onPick, nested }: { items: MenuItem[]; onPick(): void; nested?: boolean }) {
  const [openChild, setOpenChild] = useState<number | undefined>();
  return (
    <ul role="menu" className={`menu-list${nested ? ' nested' : ''}`}>
      {items.map((item, index) =>
        item.separator ? (
          <li key={`sep-${index}`} role="separator" className="menu-separator" />
        ) : (
          <li key={item.label} role="none" onMouseEnter={() => setOpenChild(item.children ? index : undefined)}>
            <button
              type="button"
              role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-label={item.label}
              aria-keyshortcuts={item.shortcut}
              aria-checked={item.checked}
              aria-haspopup={item.children ? 'menu' : undefined}
              aria-expanded={item.children ? openChild === index : undefined}
              disabled={item.disabled}
              className="menu-item"
              data-testid={item.testId}
              onClick={() => {
                if (item.children) {
                  setOpenChild(openChild === index ? undefined : index);
                  return;
                }
                onPick();
                item.run?.();
              }}
            >
              <span className="menu-check">{item.checked ? '✓' : ''}</span>
              <span className="menu-label">{item.label}</span>
              <span className="menu-shortcut">{item.children ? '▸' : item.shortcut}</span>
            </button>
            {item.children && openChild === index && !item.disabled && <MenuList items={item.children} onPick={onPick} nested />}
          </li>
        ),
      )}
    </ul>
  );
}

/** The menu bar: File, Edit, View, Run, Help. Every command also has a shortcut where R3 §1.3 defines one. */
export function MenuBar() {
  const controller = useController();
  const state = useAppState();
  const [open, setOpen] = useState<number | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open === undefined) return undefined;
    const close = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(undefined);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const menus = buildMenus(controller, state, () => fileInput.current?.click());
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open !== undefined) {
      setOpen(undefined);
      controller.focusActive();
    }
  };

  return (
    <div className="menubar" role="menubar" ref={root} onKeyDown={onKeyDown}>
      {menus.map((menu, index) => (
        <div key={menu.label} className="menu" onMouseEnter={() => open !== undefined && setOpen(index)}>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === index} className={`menu-title${open === index ? ' open' : ''}`} onClick={() => setOpen(open === index ? undefined : index)}>
            {menu.label}
          </button>
          {open === index && (
            <MenuList
              items={menu.items}
              onPick={() => {
                setOpen(undefined);
              }}
            />
          )}
        </div>
      ))}
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="import-zip-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void file.arrayBuffer().then((buffer) => controller.importZipData(new Uint8Array(buffer), file.name));
        }}
      />
    </div>
  );
}
