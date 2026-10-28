/**
 * A syntax checker for the expressions Activiti evaluates with JUEL (EL 2.2: no assignment, no `;`, no lambdas, no string
 * `+`). It validates a text with `${...}` / `#{...}` segments the way the engine's ExpressionFactory parses it and reports the
 * position of the first error. It does not evaluate anything.
 */

export interface JuelIssue {
  message: string;
  /** Offset in the checked text. */
  position: number;
}

export interface JuelResult {
  issues: JuelIssue[];
  /** `+` with a string literal as an operand: JUEL coerces both sides to numbers and fails (engine finding 36). */
  stringPlus: JuelIssue[];
  /** Whether the text contains at least one `${...}` / `#{...}` segment. */
  hasExpression: boolean;
}

const KEYWORDS = new Set(['true', 'false', 'null', 'empty', 'instanceof', 'and', 'or', 'not', 'div', 'mod', 'eq', 'ne', 'lt', 'gt', 'le', 'ge']);
const WORD_OPERATORS: Record<string, string> = { and: '&&', or: '||', not: '!', div: '/', mod: '%', eq: '==', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=' };

type Token =
  | { kind: 'num' | 'str' | 'id' | 'kw' | 'op' | 'eof'; text: string; position: number };

class JuelError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
  }
}

function tokenize(source: string, offset: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const fail = (message: string, at = i): never => {
    throw new JuelError(message, offset + at);
  };
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (c === '"' || c === "'") {
      i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      if (i >= source.length) fail('unterminated string literal', start);
      i += 1;
      tokens.push({ kind: 'str', text: source.slice(start, i), position: offset + start });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(source.slice(i));
      i += m![0].length;
      tokens.push({ kind: 'num', text: m![0], position: offset + start });
      continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      const m = /^[\p{L}\p{N}_$]+/u.exec(source.slice(i));
      i += m![0].length;
      const text = m![0];
      tokens.push({ kind: KEYWORDS.has(text) ? 'kw' : 'id', text, position: offset + start });
      continue;
    }
    const three = source.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(three)) {
      i += 2;
      tokens.push({ kind: 'op', text: three, position: offset + start });
      continue;
    }
    if ('+-*/%<>!?:.,()[]'.includes(c)) {
      i += 1;
      tokens.push({ kind: 'op', text: c, position: offset + start });
      continue;
    }
    if (c === '=') fail('"=" is not an operator of the expression language (there is no assignment; use "==" to compare)');
    if (c === ';') fail('";" is not allowed (EL 2.2 has no statement sequences)');
    if (c === '{' || c === '}') fail(`unexpected "${c}" inside an expression`);
    fail(`unexpected character "${c}"`);
  }
  tokens.push({ kind: 'eof', text: '', position: offset + source.length });
  return tokens;
}

class Parser {
  private index = 0;
  readonly stringPlus: JuelIssue[] = [];

  constructor(private readonly tokens: Token[]) {}

  private get tok(): Token {
    return this.tokens[this.index]!;
  }

  private isOp(text: string): boolean {
    const t = this.tok;
    return (t.kind === 'op' && t.text === text) || (t.kind === 'kw' && WORD_OPERATORS[t.text] === text);
  }

  private take(text: string): boolean {
    if (!this.isOp(text)) return false;
    this.index += 1;
    return true;
  }

  private expect(text: string, what: string): void {
    if (!this.take(text)) throw new JuelError(`expected ${what} but found ${this.describe()}`, this.tok.position);
  }

  private describe(): string {
    return this.tok.kind === 'eof' ? 'the end of the expression' : `"${this.tok.text}"`;
  }

  parse(): void {
    this.ternary();
    if (this.tok.kind !== 'eof') throw new JuelError(`unexpected ${this.describe()}`, this.tok.position);
  }

  private ternary(): void {
    this.binary(0);
    if (this.take('?')) {
      this.ternary();
      this.expect(':', '":" of the conditional expression');
      this.ternary();
    }
  }

  private static LEVELS: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

  /** Left associative binary operators by level; returns whether the parsed operand was a string literal. */
  private binary(level: number): boolean {
    if (level >= Parser.LEVELS.length) return this.unary();
    let leftIsString = this.binary(level + 1);
    for (;;) {
      const op = Parser.LEVELS[level]!.find((candidate) => this.isOp(candidate));
      if (!op) return leftIsString;
      const operator = this.tok;
      this.index += 1;
      const rightIsString = this.binary(level + 1);
      if (op === '+' && (leftIsString || rightIsString)) {
        this.stringPlus.push({ message: 'string concatenation with "+" does not work in the expression language (both sides are converted to numbers); use .concat(...) or a ${a}${b} text', position: operator.position });
      }
      leftIsString = false;
    }
  }

  /** Returns true when the operand is a bare string literal. */
  private unary(): boolean {
    const isEmptyKeyword = this.tok.kind === 'kw' && this.tok.text === 'empty';
    if (isEmptyKeyword) this.index += 1;
    if (isEmptyKeyword || this.take('!') || this.take('-')) {
      this.unary();
      return false;
    }
    return this.postfix();
  }

  private postfix(): boolean {
    const first = this.tok;
    let isLiteralString = false;
    this.primary();
    if (first.kind === 'str') isLiteralString = true;
    for (;;) {
      if (this.take('.')) {
        const t = this.tok;
        if (t.kind !== 'id' && t.kind !== 'kw') throw new JuelError(`expected a property name after "." but found ${this.describe()}`, t.position);
        this.index += 1;
        isLiteralString = false;
        continue;
      }
      if (this.take('[')) {
        this.ternary();
        this.expect(']', '"]"');
        isLiteralString = false;
        continue;
      }
      if (this.isOp('(')) {
        this.index += 1;
        this.args();
        isLiteralString = false;
        continue;
      }
      return isLiteralString;
    }
  }

  private args(): void {
    if (this.take(')')) return;
    do this.ternary();
    while (this.take(','));
    this.expect(')', '")" after the arguments');
  }

  private primary(): void {
    const t = this.tok;
    if (t.kind === 'num' || t.kind === 'str') {
      this.index += 1;
      return;
    }
    if (t.kind === 'kw' && ['true', 'false', 'null'].includes(t.text)) {
      this.index += 1;
      return;
    }
    if (t.kind === 'id') {
      this.index += 1;
      // prefixed function: ns:name(args)
      if (this.isOp(':') && this.tokens[this.index + 1]?.kind === 'id' && this.tokens[this.index + 2]?.text === '(') this.index += 2;
      return;
    }
    if (this.take('(')) {
      this.ternary();
      this.expect(')', '")"');
      return;
    }
    throw new JuelError(`unexpected ${this.describe()}`, t.position);
  }
}

/** Finds the end of an expression segment starting after `${`: the matching `}` outside string literals. */
function segmentEnd(text: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '}') return i;
  }
  return -1;
}

/** Checks a text that may contain `${...}` / `#{...}` segments (a JUEL composite expression). Plain text is valid. */
export function checkJuel(text: string): JuelResult {
  const result: JuelResult = { issues: [], stringPlus: [], hasExpression: false };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\\' && (text[i + 1] === '$' || text[i + 1] === '#' || text[i + 1] === '\\')) {
      i += 2;
      continue;
    }
    if ((c === '$' || c === '#') && text[i + 1] === '{') {
      result.hasExpression = true;
      const end = segmentEnd(text, i + 2);
      if (end < 0) {
        result.issues.push({ message: `"${c}{" is not closed: the closing "}" is missing`, position: i });
        return result;
      }
      const inner = text.slice(i + 2, end);
      if (inner.trim() === '') {
        result.issues.push({ message: 'the expression is empty', position: i });
      } else {
        try {
          const parser = new Parser(tokenize(inner, i + 2));
          parser.parse();
          result.stringPlus.push(...parser.stringPlus);
        } catch (e) {
          if (e instanceof JuelError) result.issues.push({ message: e.message, position: e.position });
          else throw e;
        }
      }
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return result;
}

/** True when the whole text is a single `${...}` / `#{...}` expression (not text around it). */
export const isPureExpression = (text: string): boolean => /^\s*[$#]\{[\s\S]*\}\s*$/.test(text) && segmentEnd(text.trim(), 2) === text.trim().length - 1;
