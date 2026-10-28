import { StreamLanguage, type StreamParser } from '@codemirror/language';

import { KEYWORDS } from './syntax';

interface State {
  inCode: boolean;
  quote: string | null;
  afterDot: boolean;
}

const WORD_OPERATORS = new Set<string>(['empty', 'not', 'and', 'or', 'div', 'mod', 'eq', 'ne', 'lt', 'gt', 'le', 'ge']);
const LITERALS = new Set<string>(KEYWORDS.filter((k) => !WORD_OPERATORS.has(k)));

function parser(block: boolean): StreamParser<State> {
  return {
    name: block ? 'juel-script' : 'juel',
    startState: () => ({ inCode: block, quote: null, afterDot: false }),
    token(stream, state) {
      if (!state.inCode) {
        if (stream.match(/^[$#]\{/)) {
          state.inCode = true;
          state.afterDot = false;
          return 'meta';
        }
        while (!stream.eol() && !stream.match(/^[$#]\{/, false)) {
          // `\${` is escaped text
          if (stream.match(/^\\[$#]\{/)) continue;
          stream.next();
        }
        return null;
      }
      if (state.quote) {
        const quote = state.quote;
        while (!stream.eol()) {
          const c = stream.next();
          if (c === '\\') stream.next();
          else if (c === quote) {
            state.quote = null;
            break;
          }
        }
        return 'string';
      }
      if (stream.eatSpace()) return null;
      if (!block && stream.eat('}')) {
        state.inCode = false;
        return 'meta';
      }
      const c = stream.peek()!;
      if (c === "'" || c === '"') {
        stream.next();
        state.quote = c;
        // the rest of the string, possibly the closing quote on this line
        while (!stream.eol()) {
          const d = stream.next();
          if (d === '\\') stream.next();
          else if (d === c) {
            state.quote = null;
            break;
          }
        }
        return 'string';
      }
      if (stream.match(/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/)) return 'number';
      if (stream.match(/^[A-Za-z_$][\w$]*/)) {
        const word = stream.current();
        const previousDot = state.afterDot;
        state.afterDot = false;
        if (previousDot) return 'propertyName';
        if (WORD_OPERATORS.has(word)) return 'operator';
        if (LITERALS.has(word)) return 'keyword';
        return 'variableName';
      }
      if (stream.match(/^(<=|>=|==|!=|&&|\|\||[-+*/%?:<>!])/)) {
        state.afterDot = false;
        return 'operator';
      }
      if (stream.eat('.')) {
        state.afterDot = true;
        return 'punctuation';
      }
      state.afterDot = false;
      if (stream.eat(/[()[\]]/)) return 'bracket';
      if (stream.eat(',')) return 'punctuation';
      stream.next();
      return 'invalid';
    },
    languageData: { closeBrackets: { brackets: ['(', '[', '{', "'", '"'] } },
  };
}

/** The JUEL language of an expression field: text with `${...}` blocks, or (`block`) the code of a script. */
export const juelLanguage = (block = false): StreamLanguage<State> => StreamLanguage.define(parser(block));
