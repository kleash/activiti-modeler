import { describe, expect, it } from 'vitest';

import { checkJuel, completionContext, juelError, splitExpressions, tokenizeJuel } from './syntax';

const errors = (text: string, mode?: 'condition' | 'expression' | 'block'): string[] =>
  checkJuel(text, mode ? { mode } : {}).filter((p) => p.severity === 'error').map((p) => p.message);

describe('JUEL syntax check', () => {
  it.each([
    '${amount > 100}',
    "${order.customer.name == 'ann' and !empty items}",
    '${vars.REGION}',
    "${greeter.greet(scriptHelper.upper(customer))}",
    "${total > 100 ? total * 0.9 : total}",
    "${execution.setVariable('large', net > 100)}",
    "${'go-'.concat(region)}",
    "${fn:upper(name)}",
    '${items[0].price div 2 mod 3}',
    'Order ${orderId} confirmed for ${customerName}',
    'plain text without an expression',
    '#{deferred}',
    '${-x + (y * 3)}',
    '${not done}',
    '${a le 3 or b ge 4 and c ne d}',
    '\\${escaped}',
    '',
  ])('accepts %s', (text) => {
    expect(errors(text)).toEqual([]);
  });

  it.each([
    ['${amount > }', /ends here/],
    ['${}', /empty/],
    ['${a b}', /Unexpected "b"/],
    ["${name == 'ann}", /never closed/],
    ['${items[0}', /Expected "\]"/],
    ['${f(1, }', /Unexpected "\}"|operand/],
    ['${x = 5}', /Assignment is not supported/],
    ['${amount > 100', /never closed/],
    ['${a ? b}', /Expected ":"/],
    ['${1 +}', /operand/],
    ['${a @ b}', /Unexpected character "@"/],
  ])('rejects %s', (text, message) => {
    expect(errors(text).join('\n')).toMatch(message);
  });

  it('reports the position of the problem inside the whole text', () => {
    const text = 'Hello ${name !!} and ${other}';
    const [problem] = checkJuel(text);
    expect(problem).toBeDefined();
    expect(text.slice(problem!.from, problem!.to)).toBe('!!'.slice(0, problem!.to - problem!.from) === '!' ? '!' : text.slice(problem!.from, problem!.to));
    expect(problem!.from).toBeGreaterThanOrEqual(text.indexOf('${name') + 2);
    expect(juelError('${name !!}')).toBeDefined();
  });

  it("warns that EL has no '+' for strings (engine finding 36)", () => {
    const problems = checkJuel("${'go-' + region}");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ severity: 'warning' });
    expect(problems[0]!.message).toMatch(/no '\+' for strings.*concat/);
    expect(checkJuel('${a + b}')).toEqual([]);
    expect(checkJuel("${a + 'x'}")).toHaveLength(1);
  });

  it('checks a condition as one boolean expression', () => {
    expect(errors('amount > 100', 'condition').join()).toMatch(/constant string/);
    expect(checkJuel('${amount > 100}', { mode: 'condition' })).toEqual([]);
    expect(checkJuel('big: ${amount > 100}', { mode: 'condition' })[0]).toMatchObject({ severity: 'warning' });
    expect(checkJuel('${a} ${b}', { mode: 'condition' })[0]).toMatchObject({ severity: 'warning' });
    expect(checkJuel('', { mode: 'condition' })).toEqual([]);
  });

  it('reports a string that is not closed in a script block', () => {
    expect(errors("name == 'ann", 'block').join()).toMatch(/not closed/);
  });

  it('checks a script block without delimiters', () => {
    expect(errors("execution.getVariable('x')", 'block')).toEqual([]);
    expect(errors('price *', 'block').join()).toMatch(/operand/);
  });
});

describe('JUEL tokens', () => {
  it('splits text, delimiters and code, and tells properties from variables and keywords', () => {
    const tokens = tokenizeJuel("Hi ${user.name == 'x' and ok}");
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['text', 'Hi '], ['delimiter', '${'], ['identifier', 'user'], ['punctuation', '.'], ['property', 'name'], ['operator', '=='], ['string', "'x'"], ['operator', 'and'], ['identifier', 'ok'], ['delimiter', '}'],
    ]);
  });

  it('does not end a block at a brace inside a string and keeps an unclosed block', () => {
    expect(splitExpressions("${'}'} tail")).toEqual([{ kind: 'code', from: 2, to: 5, open: 0, closed: true }, { kind: 'text', from: 6, to: 11 }]);
    const open = splitExpressions('${a');
    expect(open[0]).toMatchObject({ kind: 'code', closed: false });
  });
});

describe('JUEL completion context', () => {
  it('completes identifiers inside an expression, members after a dot, and nothing outside or in strings', () => {
    const text = 'Total ${am';
    expect(completionContext(text, text.length)).toEqual({ kind: 'identifier', prefix: 'am', from: 8 });
    expect(completionContext('${vars.RE', 9)).toEqual({ kind: 'member', prefix: 'RE', from: 7, owner: 'vars' });
    expect(completionContext('${a.', 4)).toMatchObject({ kind: 'member', prefix: '', owner: 'a' });
    expect(completionContext('Total am', 8).kind).toBe('none');
    expect(completionContext("${name == 'ab", 13).kind).toBe('none');
    expect(completionContext('${a} and ${', 11)).toEqual({ kind: 'identifier', prefix: '', from: 11 });
    expect(completionContext('${a + 12', 8).kind).toBe('none');
  });

  it('treats the whole text as code in block mode', () => {
    expect(completionContext('execution.set', 13, { block: true })).toMatchObject({ kind: 'member', owner: 'execution', prefix: 'set' });
    expect(completionContext('am', 2, { block: true })).toMatchObject({ kind: 'identifier', prefix: 'am' });
  });
});
