const TOKEN = Object.freeze({
  IDENTIFIER: 'identifier',
  STRING: 'string',
  NUMBER: 'number',
  OPERATOR: 'operator',
  PUNCTUATION: 'punctuation',
  KEYWORD: 'keyword',
  EOF: 'eof',
});

export const TRI_STATE = Object.freeze({
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  UNKNOWN: 'UNKNOWN',
});

const UNKNOWN_VALUE = Symbol('unknown-value');

export function parseApplicabilityPredicate(source) {
  const parser = new PredicateParser(tokenize(source));
  const ast = parser.parseExpression();
  parser.expect(TOKEN.EOF);
  return ast;
}

export function evaluateApplicabilityPredicate(sourceOrAst, context = {}) {
  const ast = typeof sourceOrAst === 'string'
    ? parseApplicabilityPredicate(sourceOrAst)
    : sourceOrAst;
  return evaluateBoolean(ast, context);
}

export function collectPredicatePaths(sourceOrAst) {
  const ast = typeof sourceOrAst === 'string'
    ? parseApplicabilityPredicate(sourceOrAst)
    : sourceOrAst;
  const paths = new Set();
  visit(ast, (node) => {
    if (node.type === 'identifier') paths.add(node.path);
  });
  return [...paths].sort();
}

function tokenize(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('Applicability predicate must be a non-empty string.');
  }
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    const two = source.slice(cursor, cursor + 2);
    if (['==', '!=', '>=', '<='].includes(two)) {
      tokens.push(token(TOKEN.OPERATOR, two, cursor));
      cursor += 2;
      continue;
    }
    if (['>', '<'].includes(char)) {
      tokens.push(token(TOKEN.OPERATOR, char, cursor));
      cursor += 1;
      continue;
    }
    if (['(', ')', '[', ']', ','].includes(char)) {
      tokens.push(token(TOKEN.PUNCTUATION, char, cursor));
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const start = cursor;
      const quote = char;
      cursor += 1;
      let value = '';
      let closed = false;
      while (cursor < source.length) {
        const current = source[cursor];
        if (current === '\\') {
          const escaped = source[cursor + 1];
          if (escaped === undefined) break;
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          cursor += 2;
          continue;
        }
        if (current === quote) {
          cursor += 1;
          closed = true;
          break;
        }
        value += current;
        cursor += 1;
      }
      if (!closed) throw syntaxError(source, start, 'Unterminated string literal');
      tokens.push(token(TOKEN.STRING, value, start));
      continue;
    }
    const numberMatch = source.slice(cursor).match(/^-?(?:\d+\.?\d*|\.\d+)/u);
    if (numberMatch) {
      tokens.push(token(TOKEN.NUMBER, Number(numberMatch[0]), cursor));
      cursor += numberMatch[0].length;
      continue;
    }
    const identifierMatch = source.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_.]*/u);
    if (identifierMatch) {
      const value = identifierMatch[0];
      const type = ['and', 'or', 'in', 'true', 'false', 'null'].includes(value)
        ? TOKEN.KEYWORD
        : TOKEN.IDENTIFIER;
      tokens.push(token(type, value, cursor));
      cursor += value.length;
      continue;
    }
    throw syntaxError(source, cursor, `Unexpected character ${JSON.stringify(char)}`);
  }
  tokens.push(token(TOKEN.EOF, null, source.length));
  return { source, tokens };
}

class PredicateParser {
  constructor(input) {
    this.source = input.source;
    this.tokens = input.tokens;
    this.cursor = 0;
  }

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let node = this.parseAnd();
    while (this.match(TOKEN.KEYWORD, 'or')) {
      node = { type: 'logical', operator: 'or', left: node, right: this.parseAnd() };
    }
    return node;
  }

  parseAnd() {
    let node = this.parseComparison();
    while (this.match(TOKEN.KEYWORD, 'and')) {
      node = { type: 'logical', operator: 'and', left: node, right: this.parseComparison() };
    }
    return node;
  }

  parseComparison() {
    const left = this.parsePrimary();
    const next = this.peek();
    const isComparison = next.type === TOKEN.OPERATOR
      || (next.type === TOKEN.KEYWORD && next.value === 'in');
    if (!isComparison) return left;
    this.cursor += 1;
    return {
      type: 'comparison',
      operator: next.value,
      left,
      right: this.parsePrimary(),
    };
  }

  parsePrimary() {
    const current = this.peek();
    if (this.match(TOKEN.PUNCTUATION, '(')) {
      const expression = this.parseExpression();
      this.expect(TOKEN.PUNCTUATION, ')');
      return expression;
    }
    if (this.match(TOKEN.PUNCTUATION, '[')) {
      const items = [];
      if (!this.match(TOKEN.PUNCTUATION, ']')) {
        do {
          items.push(this.parsePrimary());
        } while (this.match(TOKEN.PUNCTUATION, ','));
        this.expect(TOKEN.PUNCTUATION, ']');
      }
      return { type: 'array', items };
    }
    if (current.type === TOKEN.IDENTIFIER) {
      this.cursor += 1;
      return { type: 'identifier', path: current.value };
    }
    if (current.type === TOKEN.STRING || current.type === TOKEN.NUMBER) {
      this.cursor += 1;
      return { type: 'literal', value: current.value };
    }
    if (current.type === TOKEN.KEYWORD && ['true', 'false', 'null'].includes(current.value)) {
      this.cursor += 1;
      return {
        type: 'literal',
        value: current.value === 'true' ? true : current.value === 'false' ? false : null,
      };
    }
    throw syntaxError(this.source, current.position, `Expected expression, found ${current.value ?? current.type}`);
  }

  match(type, value) {
    const current = this.peek();
    if (current.type !== type || (value !== undefined && current.value !== value)) return false;
    this.cursor += 1;
    return true;
  }

  expect(type, value) {
    const current = this.peek();
    if (!this.match(type, value)) {
      throw syntaxError(
        this.source,
        current.position,
        `Expected ${value ?? type}, found ${current.value ?? current.type}`,
      );
    }
    return current;
  }

  peek() {
    return this.tokens[this.cursor];
  }
}

function evaluateBoolean(node, context) {
  if (node.type === 'logical') {
    const left = evaluateBoolean(node.left, context);
    const right = evaluateBoolean(node.right, context);
    if (node.operator === 'and') {
      if (left === TRI_STATE.FALSE || right === TRI_STATE.FALSE) return TRI_STATE.FALSE;
      if (left === TRI_STATE.TRUE && right === TRI_STATE.TRUE) return TRI_STATE.TRUE;
      return TRI_STATE.UNKNOWN;
    }
    if (left === TRI_STATE.TRUE || right === TRI_STATE.TRUE) return TRI_STATE.TRUE;
    if (left === TRI_STATE.FALSE && right === TRI_STATE.FALSE) return TRI_STATE.FALSE;
    return TRI_STATE.UNKNOWN;
  }
  if (node.type === 'comparison') return evaluateComparison(node, context);
  const value = evaluateValue(node, context);
  if (value === UNKNOWN_VALUE || typeof value !== 'boolean') return TRI_STATE.UNKNOWN;
  return value ? TRI_STATE.TRUE : TRI_STATE.FALSE;
}

function evaluateComparison(node, context) {
  const left = evaluateValue(node.left, context);
  const right = evaluateValue(node.right, context);
  if (left === UNKNOWN_VALUE || right === UNKNOWN_VALUE) return TRI_STATE.UNKNOWN;
  let result;
  switch (node.operator) {
    case '==': result = left === right; break;
    case '!=': result = left !== right; break;
    case '>':
    case '>=':
    case '<':
    case '<=':
      if (typeof left !== 'number' || typeof right !== 'number'
        || !Number.isFinite(left) || !Number.isFinite(right)) return TRI_STATE.UNKNOWN;
      result = node.operator === '>'
        ? left > right
        : node.operator === '>='
          ? left >= right
          : node.operator === '<'
            ? left < right
            : left <= right;
      break;
    case 'in':
      if (!Array.isArray(right)) return TRI_STATE.UNKNOWN;
      result = right.includes(left);
      break;
    default: throw new Error(`Unsupported comparison operator: ${node.operator}`);
  }
  return result ? TRI_STATE.TRUE : TRI_STATE.FALSE;
}

function evaluateValue(node, context) {
  if (node.type === 'literal') return node.value;
  if (node.type === 'identifier') return resolvePath(context, node.path);
  if (node.type === 'array') {
    const values = node.items.map((item) => evaluateValue(item, context));
    return values.includes(UNKNOWN_VALUE) ? UNKNOWN_VALUE : values;
  }
  const boolean = evaluateBoolean(node, context);
  return boolean === TRI_STATE.UNKNOWN ? UNKNOWN_VALUE : boolean === TRI_STATE.TRUE;
}

function resolvePath(context, path) {
  let current = context;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return UNKNOWN_VALUE;
    }
    current = current[segment];
  }
  return current === undefined ? UNKNOWN_VALUE : current;
}

function visit(node, callback) {
  callback(node);
  if (node.left) visit(node.left, callback);
  if (node.right) visit(node.right, callback);
  for (const item of node.items ?? []) visit(item, callback);
}

function token(type, value, position) {
  return { type, value, position };
}

function syntaxError(source, position, message) {
  const error = new SyntaxError(`${message} at column ${position + 1}: ${source}`);
  error.position = position;
  return error;
}
