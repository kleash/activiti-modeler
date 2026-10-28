import { t } from '../i18n';
import { emptyRow, VARIABLE_TYPES, type VariableRow } from './variables';

/** Rows of typed variables (name, type, value). The caller converts them with `rowsToVariables`. */
export function VariablesEditor({ rows, onChange, errors = {}, testId = 'variables-editor', addLabel = t('run.variables.add') }: { rows: VariableRow[]; onChange(rows: VariableRow[]): void; errors?: Record<string, string>; testId?: string; addLabel?: string }) {
  const update = (key: string, patch: Partial<VariableRow>): void => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="variables-editor" data-testid={testId}>
      {rows.length > 0 && (
        <table className="run-table variables">
          <thead>
            <tr>
              <th>{t('run.variables.name')}</th>
              <th>{t('run.variables.type')}</th>
              <th>{t('run.variables.value')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} data-testid={`${testId}-row-${row.name || index}`}>
                <td>
                  <input
                    value={row.name}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                    aria-label={t('run.variables.rowName', { number: index + 1 })}
                    readOnly={row.declared === true}
                    className={row.declared ? 'declared' : ''}
                    title={row.description}
                    spellCheck={false}
                    data-testid={`${testId}-name-${index}`}
                  />
                  {row.required && <span className="required" title={t('run.variables.required')}> *</span>}
                </td>
                <td>
                  <select value={row.type} onChange={(e) => update(row.key, { type: e.target.value as VariableRow['type'] })} aria-label={t('run.variables.rowType', { number: index + 1 })} data-testid={`${testId}-type-${index}`}>
                    {VARIABLE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input value={row.text} onChange={(e) => update(row.key, { text: e.target.value })} aria-label={t('run.variables.rowValue', { number: index + 1 })} spellCheck={false} aria-invalid={!!errors[row.key]} data-testid={`${testId}-value-${index}`} />
                  {errors[row.key] && <div className="field-error small" role="alert">{errors[row.key]}</div>}
                </td>
                <td>
                  <button type="button" className="btn small" onClick={() => onChange(rows.filter((r) => r.key !== row.key))} aria-label={t('run.variables.rowRemove', { name: row.name || index + 1 })}>
                    x
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn small" onClick={() => onChange([...rows, emptyRow()])} data-testid={`${testId}-add`}>
        {addLabel}
      </button>
    </div>
  );
}
