/**
 * JUEL (Unified Expression Language 2.2) as Activiti evaluates it: the tokenizer, a syntax check and the context of the
 * cursor for autocompletion. Text outside `${...}` / `#{...}` is literal; `\${` escapes the delimiter.
 *
 * What the check catches: unbalanced braces, brackets and quotes, a missing operand, a stray token, an assignment (`=`,
 * the engine's EL 2.2 cannot assign), and `+` on a string literal (EL has no string concatenation: engine finding 36).
 */

export type TokenType = 'text' | 'delimiter' | 'keyword' | 'operator' | 'string' | 'number' | 'identifier' | 'property' | 'bracket' | 'punctuation' | 'invalid';

export interface JuelToken {
  type: TokenType;
  from: number;
  to: number;
  value: string;
}

export interface JuelProblem {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

export const KEYWORDS = ['true', 'false', 'null', 'empty', 'not', 'and', 'or', 'div', 'mod', 'eq', 'ne', 'lt', 'gt', 'le', 'ge'] as const;
const KEYWORD_SET = new Set<string>(KEYWORDS);
const WORD_OPERATORS = new Set(['not', 'and', 'or', 'div', 'mod', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'empty']);

const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c) || c > '\u007f';
const isIdentPart = (c: string): boolean => /[\w$]/.test(c) || c > '\u007f';

const OPERATOR_CHARS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '?', ':', '<', '>', '!', '='] as const;

interface Segment {
  /** Literal text outside an expression, or the code of one `${...}`. */
  kind: 'text' | 'code';
  from: number;
  to: number;
  /** For code: the position of the opening delimiter and whether it was closed. */
  open?: number;
  closed?: boolean;
}

/** Splits a value into literal text and expression blocks; a `}` inside a quoted string does not close a block. */
export function splitExpressions(text: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let textFrom = 0;
  const flushText = (to: number): void => {
    if (to > textFrom) segments.push({ kind: 'text', from: textFrom, to });
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\\' && (text[i + 1] === '$' || text[i + 1] === '#') && text[i + 2] === '{') {
      i += 2;
      continue;
    }
    if ((c === '$' || c === '#') && text[i + 1] === '{') {
      flushText(i);
      const open = i;
      let j = i + 2;
      let quote: string | undefined;
      let closed = false;
      for (; j < text.length; j += 1) {
        const d = text[j]!;
        if (quote) {
          if (d === '\\') j += 1;
          else if (d === quote) quote = undefined;
        } else if (d === "'" || d === '"') quote = d;
        else if (d === '}') {
          closed = true;
          break;
        }
      }
      segments.push({ kind: 'code', from: open + 2, to: j, open, closed });
      i = closed ? j + 1 : j;
      textFrom = i;
      continue;
    }
    i += 1;
  }
  flushText(text.length);
  return segments;
}

/** Tokens of the code between `from` and `to`; `base` is added to the positions. */
function tokenizeCode(text: string, from: number, to: number): JuelToken[] {
  const tokens: JuelToken[] = [];
  let i = from;
  const push = (type: TokenType, start: number, end: number): void => void tokens.push({ type, from: start, to: end, value: text.slice(start, end) });
  while (i < to) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < to && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, to);
      push(j >= to ? 'invalid' : 'string', i, end);
      i = end;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(text[i + 1] ?? ''))) {
      const match = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i, to))!;
      push('number', i, i + match[0].length);
      i += match[0].length;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < to && isIdentPart(text[j]!)) j += 1;
      const word = text.slice(i, j);
      const previous = tokens[tokens.length - 1];
      if (previous?.value === '.' && previous.type === 'punctuation') push('property', i, j);
      else if (KEYWORD_SET.has(word)) push(WORD_OPERATORS.has(word) ? 'operator' : 'keyword', i, j);
      else push('identifier', i, j);
      i = j;
      continue;
    }
    const operator = OPERATOR_CHARS.find((op) => text.startsWith(op, i));
    if (operator && i + operator.length <= to) {
      push('operator', i, i + operator.length);
      i += operator.length;
      continue;
    }
    if ('()[]'.includes(c)) push('bracket', i, i + 1);
    else if ('.,'.includes(c)) push('punctuation', i, i + 1);
    else push('invalid', i, i + 1);
    i += 1;
  }
  return tokens;
}

/** All tokens of a value: literal text, the delimiters and the tokens of the code. */
export function tokenizeJuel(text: string): JuelToken[] {
  const tokens: JuelToken[] = [];
  for (const segment of splitExpressions(text)) {
    if (segment.kind === 'text') {
      tokens.push({ type: 'text', from: segment.from, to: segment.to, value: text.slice(segment.from, segment.to) });
      continue;
    }
    tokens.push({ type: 'delimiter', from: segment.open!, to: segment.open! + 2, value: text.slice(segment.open!, segment.open! + 2) });
    tokens.push(...tokenizeCode(text, segment.from, segment.to));
    if (segment.closed) tokens.push({ type: 'delimiter', from: segment.to, to: segment.to + 1, value: '}' });
  }
  return tokens;
}

// --- parser -------------------------------------------------------------------------------------------------------------------

const ASSIGNMENT = "Assignment is not supported: the expression language cannot assign. Use execution.setVariable('name', value) in a script or listener.";

class Parser {
  private index = 0;
  readonly problems: JuelProblem[] = [];

  constructor(
    private readonly tokens: JuelToken[],
    private readonly end: number,
  ) {}

  private get current(): JuelToken | undefined {
    return this.tokens[this.index];
  }

  private fail(message: string, token?: JuelToken): never {
    const at = token ?? this.current;
    throw Object.assign(new Error(message), { from: at?.from ?? this.end, to: at?.to ?? this.end });
  }

  private is(value: string): boolean {
    const t = this.current;
    return !!t && t.value === value && (t.type === 'operator' || t.type === 'bracket' || t.type === 'punctuation');
  }

  private eat(value: string): boolean {
    if (!this.is(value)) return false;
    this.index += 1;
    return true;
  }

  private expect(value: string, what = `"${value}"`): JuelToken {
    if (!this.is(value)) this.fail(this.current ? `Expected ${what}, found "${this.current.value}"` : `Expected ${what}, the expression ends here`);
    return this.tokens[this.index++]!;
  }

  parse(): void {
    if (this.tokens.length === 0) this.fail('An expression is empty');
    this.ternary();
    const rest = this.current;
    if (rest?.value === '=') this.fail(ASSIGNMENT, rest);
    if (rest?.type === 'invalid') this.fail(`Unexpected character "${rest.value}"`, rest);
    if (rest) this.fail(`Unexpected "${rest.value}"`);
  }

  private ternary(): void {
    this.binary(0);
    if (this.eat('?')) {
      this.ternary();
      this.expect(':');
      this.ternary();
    }
  }

  private static readonly LEVELS: ReadonlyArray<readonly string[]> = [['||', 'or'], ['&&', 'and'], ['==', 'eq', '!=', 'ne'], ['<', 'lt', '>', 'gt', '<=', 'le', '>=', 'ge'], ['+', '-'], ['*', '/', 'div', '%', 'mod']];

  private binary(level: number): void {
    if (level >= Parser.LEVELS.length) return this.unary();
    this.binary(level + 1);
    for (;;) {
      const t = this.current;
      if (!t || t.type !== 'operator' || !Parser.LEVELS[level]!.includes(t.value)) return;
      this.index += 1;
      const left = this.tokens[this.index - 2];
      this.binary(level + 1);
      if (t.value === '+') this.checkPlus(t, left, this.tokens[this.index - 1]);
    }
  }

  /** `+` needs numbers: a string literal next to it is the Java habit of concatenating (engine finding 36). */
  private checkPlus(plus: JuelToken, left: JuelToken | undefined, right: JuelToken | undefined): void {
    if (left?.type === 'string' || right?.type === 'string') {
      this.problems.push({
        from: plus.from,
        to: plus.to,
        severity: 'warning',
        message: "EL has no '+' for strings: it fails with \"Cannot coerce ... to Double\". Use ${'text'.concat(value)} or put the parts side by side: text ${value}.",
      });
    }
  }

  private unary(): void {
    const t = this.current;
    if (t && t.type === 'operator' && ['!', 'not', '-', 'empty'].includes(t.value)) {
      this.index += 1;
      return this.unary();
    }
    this.value();
  }

  private value(): void {
    this.primary();
    for (;;) {
      if (this.eat('.')) {
        const t = this.current;
        if (!t || (t.type !== 'property' && t.type !== 'identifier' && t.type !== 'keyword' && t.type !== 'operator')) this.fail('Expected a property name after "."');
        this.index += 1;
        continue;
      }
      if (this.eat('[')) {
        this.ternary();
        this.expect(']');
        continue;
      }
      if (this.is('(')) {
        this.arguments();
        continue;
      }
      return;
    }
  }

  private arguments(): void {
    this.expect('(');
    if (this.eat(')')) return;
    do this.ternary();
    while (this.eat(','));
    this.expect(')');
  }

  private primary(): void {
    const t = this.current;
    if (!t) this.fail('Expected an operand, the expression ends here');
    if (t.type === 'invalid') this.fail(t.value.startsWith('"') || t.value.startsWith("'") ? `The string ${t.value} is not closed` : `Unexpected character "${t.value}"`, t);
    if (t.type === 'string' || t.type === 'number' || t.type === 'keyword') {
      this.index += 1;
      return;
    }
    if (t.type === 'identifier') {
      this.index += 1;
      // fn:name(args)
      if (this.is(':') && this.tokens[this.index + 1]?.type === 'identifier' && this.tokens[this.index + 2]?.value === '(') {
        this.index += 2;
        this.arguments();
      }
      return;
    }
    if (this.eat('(')) {
      this.ternary();
      this.expect(')');
      return;
    }
    if (t.value === '=') this.fail(ASSIGNMENT, t);
    this.fail(`Unexpected "${t.value}"`, t);
  }
}

export interface CheckOptions {
  /**
   * `condition`: a sequence flow condition is one `${...}` that gives a boolean;
   * `expression`: any mix of text and `${...}` (the default);
   * `block`: the whole text is the code of an expression (no delimiters), as in a script field.
   */
  mode?: 'condition' | 'expression' | 'block';
}

/** Syntax problems of a value, with positions; empty when it is fine. */
export function checkJuel(text: string, options: CheckOptions = {}): JuelProblem[] {
  const mode = options.mode ?? 'expression';
  const problems: JuelProblem[] = [];
  const parseCode = (from: number, to: number, openAt?: number): void => {
    const tokens = tokenizeCode(text, from, to);
    const parser = new Parser(tokens, to);
    try {
      parser.parse();
    } catch (e) {
      const error = e as Error & { from?: number; to?: number };
      const start = tokens.length === 0 && openAt !== undefined ? openAt : (error.from ?? from);
      problems.push({ from: start, to: Math.max(error.to ?? to, start + 1), message: error.message, severity: 'error' });
    }
    problems.push(...parser.problems);
  };

  if (mode === 'block') {
    if (text.trim() !== '') parseCode(0, text.length);
    return problems;
  }

  const segments = splitExpressions(text);
  for (const segment of segments) {
    if (segment.kind !== 'code') continue;
    if (!segment.closed) {
      problems.push({ from: segment.open!, to: Math.min(text.length, segment.open! + 2), message: `The expression "${text.slice(segment.open!, segment.open! + 2)}" is never closed: add a "}".`, severity: 'error' });
      continue;
    }
    parseCode(segment.from, segment.to, segment.open);
  }
  if (mode === 'condition' && text.trim() !== '') {
    const code = segments.filter((s) => s.kind === 'code');
    const outside = segments.filter((s) => s.kind === 'text' && text.slice(s.from, s.to).trim() !== '');
    if (code.length === 0) {
      problems.push({ from: 0, to: text.length, message: 'A condition is an expression such as ${amount > 100}. Without ${...} the text is a constant string, which is never true or false.', severity: 'error' });
    } else if (outside.length > 0 || code.length > 1) {
      problems.push({ from: 0, to: text.length, message: 'A condition is a single ${...} expression; text around it makes the result a string, not a boolean.', severity: 'warning' });
    }
  }
  return problems;
}

/** The first error of a value as one message with its position, or undefined. */
export function juelError(text: string, options?: CheckOptions): string | undefined {
  const problems = checkJuel(text, options);
  const first = problems.find((p) => p.severity === 'error');
  return first ? first.message : undefined;
}

// --- completion context ------------------------------------------------------------------------------------------------------

export interface CompletionContext {
  /** `identifier`: a name to complete; `member`: after a dot; `none`: outside an expression or in a string. */
  kind: 'identifier' | 'member' | 'none';
  /** The text typed so far of the word. */
  prefix: string;
  /** Where the replaced word starts. */
  from: number;
  /** For `member`: the identifier before the dot (`vars` in `vars.PATH`), if it is a plain name. */
  owner?: string;
}

/**
 * What completes at `position`: inside an open `${...}` (or all text in `block` mode) the word before the cursor is an
 * identifier, or a member when a dot precedes it. Strings and literal text complete nothing.
 */
export function completionContext(text: string, position: number, options: { block?: boolean } = {}): CompletionContext {
  const none: CompletionContext = { kind: 'none', prefix: '', from: position };
  const before = text.slice(0, position);
  let codeStart: number;
  if (options.block) {
    codeStart = 0;
  } else {
    // the innermost block that is still open at the cursor
    const segment = splitExpressions(text).find((s) => s.kind === 'code' && position >= s.from && (position <= s.to || !s.closed));
    if (!segment) return none;
    codeStart = segment.from;
  }
  const code = before.slice(codeStart);
  // inside a string literal?
  let quote: string | undefined;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
  }
  if (quote) return none;
  const word = /[\w$]*$/.exec(code)![0];
  const from = position - word.length;
  const beforeWord = code.slice(0, code.length - word.length);
  const dot = /([\w$]+)?\s*\.\s*$/.exec(beforeWord);
  if (dot) return { kind: 'member', prefix: word, from, ...(dot[1] ? { owner: dot[1] } : {}) };
  // a number cannot be completed
  if (/^\d/.test(word)) return none;
  return { kind: 'identifier', prefix: word, from };
}
