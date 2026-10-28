import type { TabState } from '../state/types';

interface Props {
  tab: TabState;
  openAsText(path: string): void;
  close(): void;
}

/** The fail-safe tab (feature U25): an editor could not open the file. Nothing is lost; the file can be fixed as text. */
export function ErrorView({ tab, openAsText, close }: Props) {
  const error = tab.error!;
  return (
    <div className="error-view" role="alert" data-testid="error-tab">
      <h2>{error.message}</h2>
      <p>The file is unchanged. You can open it as text and fix it by hand, then reopen it in the editor.</p>
      {error.detail && <pre className="error-detail">{error.detail}</pre>}
      <div className="button-row">
        {error.textFiles.map((file) => (
          <button key={file} type="button" className="btn primary" onClick={() => openAsText(file)}>
            Open {file} as text
          </button>
        ))}
        <button type="button" className="btn" onClick={close}>
          Close tab
        </button>
      </div>
    </div>
  );
}
