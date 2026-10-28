const JUEL_OPERATOR_WORDS = new Set([
  'and', 'or', 'not', 'empty', 'div', 'mod', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'instanceof',
  'true', 'false', 'null',
]);

/**
 * Names of the process variables a JUEL expression reads: the root identifier of every `${...}` or `#{...}`
 * block (`${order.total > limit}` gives `order` and `limit`). Property names, string literals, JUEL
 * operator words and function names (`fn:upper(x)`) are not variables.
 */
export function variablesInExpression(expression: string): string[] {
  const found = new Set<string>();
  for (const block of expression.matchAll(/[$#]\{([^}]*)\}/g)) {
    const code = (block[1] ?? '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ' ');
    for (const match of code.matchAll(/(^|[^\w.$:])([A-Za-z_$][\w$]*)(?!\s*[(:])(?![\w$])/g)) {
      const name = match[2] as string;
      if (!JUEL_OPERATOR_WORDS.has(name)) {
        found.add(name);
      }
    }
  }
  return [...found];
}
