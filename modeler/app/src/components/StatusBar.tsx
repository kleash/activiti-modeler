import { t } from '../i18n';
import { lintService } from '../lint/LintService';
import { useLint } from '../lint/useLint';
import { ServerStatus } from '../run/ConnectionDialog';
import { useAppState, useController } from '../state/context';

/** The status bar: where the project lives, unsaved files, the lint counters, the server connection (R1), the target. */
export function StatusBar() {
  const controller = useController();
  const state = useAppState();
  const lint = useLint();
  const project = state.project;
  const unsaved = project?.dirtyPaths.size ?? 0;
  return (
    <footer className="status-bar" data-testid="status-bar">
      <span data-testid="status-storage" title={project?.key}>
        {project ? `${project.label}: ${project.name}` : t('status.noProject')}
      </span>
      <span data-testid="status-saved">{unsaved === 0 ? t('status.saved') : t('status.unsaved', { count: unsaved })}</span>
      <button
        type="button"
        className="status-button"
        onClick={() => {
          if (!state.layout.bottomOpen) void controller.run('toggleBottom');
          lintService.showProblems();
        }}
        title={t('status.problemsTitle')}
        data-testid="status-problems"
      >
        {t('status.problems')}{' '}
        <span className="counter error" data-testid="status-errors">
          {t(lint.counts.error === 1 ? 'status.error.one' : 'status.error.other', { count: lint.counts.error })}
        </span>
        ,{' '}
        <span className="counter warning" data-testid="status-warnings">
          {t(lint.counts.warning === 1 ? 'status.warning.one' : 'status.warning.other', { count: lint.counts.warning })}
        </span>
      </button>
      <span className="spacer" />
      <ServerStatus />
      <span data-testid="status-target">Activiti 9.0.0</span>
    </footer>
  );
}
