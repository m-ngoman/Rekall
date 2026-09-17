/** A tiny, safe evaluator for the arithmetic a study tutor actually writes.
 *
 * The tutor sends an expression as text and we plot it. That text comes from a language model,
 * so `eval` and `new Function` are both out — not as a precaution but as the whole point: they
 * would hand arbitrary code execution to whatever the model was talked into writing. This parses
 * to a tree and walks it, so the worst a hostile string can do is fail to parse.
 *
 * Scope is deliberately school maths: one variable, the usual operators, the functions that turn
 * up in a syllabus. No assignment, no comparison, no calls we didn't name.
 *
 * Grammar, with the two traps written down because both are easy to get wrong:
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-' | '+')* factor
 *   factor  := primary ('^' unary)?
 *   primary := NUMBER | 'x' | CONST | FUNC '(' expr ')' | '(' expr ')'
 *
 * Trap one: `^` binds tighter than unary minus, so `-x^2` is −(x²) and not (−x)². That falls out
 * of `unary` sitting *above* `factor` rather than below it.
 *
 * Trap two: the right operand of `^` is a `unary`, not a `factor`. That buys two things at once —
 * right associativity, so `2^3^2` is 2^9 and not 8^2, and a negative exponent, so `2^-1` parses
 * instead of erroring at the minus.
 */

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var' }
  | { kind: 'neg'; operand: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: Node; right: Node }
  | { kind: 'call'; fn: keyof typeof FUNCTIONS; arg: Node }

/** Thrown only by `parse`. Evaluation never throws — see `evaluate`. */
export class ExprError extends Error {
  constructor(
    message: string,
    /** Index into the source string, so a caller can point at the problem. */
    readonly position: number,
  ) {
    super(message)
    this.name = 'ExprError'
  }
}

/** `ln` is natural and `log` is base 10. Stated here and in the tutor's prompt, because a model
 * left to guess will pick differently on different days. */
const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
} as const

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 }

/** `Object.hasOwn` in spirit, but the project targets ES2020 and that is ES2022. Widening the
 * whole app's target to tidy one line here would be the wrong trade. */
const own = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key)

type Token =
  | { type: 'num'; value: number; at: number }
  | { type: 'name'; value: string; at: number }
  | { type: 'op'; value: string; at: number }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') {
      i += 1
      continue
    }
    if (c >= '0' && c <= '9') {
      const start = i
      while (i < src.length && /[0-9]/.test(src[i])) i += 1
      if (src[i] === '.') {
        i += 1
        while (i < src.length && /[0-9]/.test(src[i])) i += 1
      }
      // Scientific notation, but only when an exponent actually follows: "2e" is the number 2
      // times the constant e, and "1e-3" is a thousandth.
      if ((src[i] === 'e' || src[i] === 'E') && /[0-9]/.test(src[i + 1] ?? '')) {
        i += 2
        while (i < src.length && /[0-9]/.test(src[i])) i += 1
      } else if ((src[i] === 'e' || src[i] === 'E') && (src[i + 1] === '+' || src[i + 1] === '-') && /[0-9]/.test(src[i + 2] ?? '')) {
        i += 3
        while (i < src.length && /[0-9]/.test(src[i])) i += 1
      }
      tokens.push({ type: 'num', value: Number(src.slice(start, i)), at: start })
      continue
    }
    if (/[a-zA-Z]/.test(c)) {
      const start = i
      while (i < src.length && /[a-zA-Z0-9]/.test(src[i])) i += 1
      tokens.push({ type: 'name', value: src.slice(start, i).toLowerCase(), at: start })
      continue
    }
    // Unicode the model reaches for even when told not to: a real minus sign, a times sign, and
    // the two division glyphs. Cheaper to accept than to argue with in the prompt.
    const normalized = { '−': '-', '–': '-', '×': '*', '·': '*', '÷': '/' }[c] ?? c
    if ('+-*/%^(),'.includes(normalized)) {
      tokens.push({ type: 'op', value: normalized, at: i })
      i += 1
      continue
    }
    throw new ExprError(`Unexpected character ${JSON.stringify(c)}`, i)
  }
  return tokens
}

/** Parses `src` into a tree. Throws `ExprError` on anything it can't read. */
export function parse(src: string): Node {
  const tokens = tokenize(src)
  let pos = 0

  const peek = (): Token | undefined => tokens[pos]
  const at = (): number => peek()?.at ?? src.length
  const isOp = (v: string): boolean => {
    const t = peek()
    return t?.type === 'op' && t.value === v
  }
  const eat = (v: string): boolean => {
    if (!isOp(v)) return false
    pos += 1
    return true
  }

  function expr(): Node {
    let left = term()
    for (;;) {
      if (eat('+')) left = { kind: 'bin', op: '+', left, right: term() }
      else if (eat('-')) left = { kind: 'bin', op: '-', left, right: term() }
      else return left
    }
  }

  function term(): Node {
    let left = unary()
    for (;;) {
      if (eat('*')) left = { kind: 'bin', op: '*', left, right: unary() }
      else if (eat('/')) left = { kind: 'bin', op: '/', left, right: unary() }
      else if (eat('%')) left = { kind: 'bin', op: '%', left, right: unary() }
      else if (implicitMultiplyFollows()) left = { kind: 'bin', op: '*', left, right: unary() }
      else return left
    }
  }

  /** Whether the next token continues an implicit product like `2x`, `3sin(x)` or `2(x+1)`.
   *
   * Models write these however firmly the prompt asks for `*`, so refusing them would mean
   * dropping plots over a convention. Only ever after a number or a closing bracket, and never
   * between two names — `xy` stays an error rather than silently becoming x times y, because a
   * model that wrote `xy` meant a second variable we don't support and should hear about it. */
  function implicitMultiplyFollows(): boolean {
    const t = peek()
    if (!t) return false
    const prev = tokens[pos - 1]
    const afterValue = prev && (prev.type === 'num' || (prev.type === 'op' && prev.value === ')'))
    if (!afterValue) return false
    if (t.type === 'num') return prev.type !== 'num'
    if (t.type === 'name') return true
    return t.type === 'op' && t.value === '('
  }

  function unary(): Node {
    if (eat('-')) return { kind: 'neg', operand: unary() }
    if (eat('+')) return unary()
    return factor()
  }

  function factor(): Node {
    const base = primary()
    // Right operand is `unary`, which gives right-associativity and allows `2^-1`.
    if (eat('^')) return { kind: 'bin', op: '^', left: base, right: unary() }
    return base
  }

  function primary(): Node {
    const t = peek()
    if (!t) throw new ExprError('Expression ended early', src.length)

    if (t.type === 'num') {
      pos += 1
      return { kind: 'num', value: t.value }
    }

    if (t.type === 'name') {
      pos += 1
      if (t.value === 'x') return { kind: 'var' }
      // Own properties only, never `in`: `in` walks the prototype chain, so "constructor",
      // "toString" and "valueOf" would all read as known names and hand back an Object.prototype
      // member where a number or a function belongs. Caught by the hostile-input cases in
      // design/handoff/expr-cases.mjs, which is exactly what they are there for.
      if (own(CONSTANTS, t.value)) return { kind: 'num', value: CONSTANTS[t.value] }
      if (own(FUNCTIONS, t.value)) {
        if (!eat('(')) throw new ExprError(`${t.value} needs a bracket, like ${t.value}(x)`, at())
        const arg = expr()
        if (!eat(')')) throw new ExprError('Missing closing bracket', at())
        return { kind: 'call', fn: t.value as keyof typeof FUNCTIONS, arg }
      }
      throw new ExprError(`Unknown name ${JSON.stringify(t.value)}`, t.at)
    }

    if (t.value === '(') {
      pos += 1
      const inner = expr()
      if (!eat(')')) throw new ExprError('Missing closing bracket', at())
      return inner
    }

    throw new ExprError(`Unexpected ${JSON.stringify(t.value)}`, t.at)
  }

  const tree = expr()
  if (pos < tokens.length) throw new ExprError(`Unexpected ${JSON.stringify(tokens[pos].value)}`, tokens[pos].at)
  return tree
}

/** Evaluates a parsed tree at one x.
 *
 * Never throws. A point the function simply doesn't reach — `sqrt(-1)`, `ln(0)`, `1/0`, `tan` at
 * an asymptote — comes back as NaN or Infinity, which is exactly what the renderer needs: those
 * are the places a curve must *break* rather than be drawn through. Turning them into exceptions
 * would mean one bad sample killing a plot that is fine everywhere else.
 */
export function evaluate(node: Node, x: number): number {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'var':
      return x
    case 'neg':
      return -evaluate(node.operand, x)
    case 'call':
      return FUNCTIONS[node.fn](evaluate(node.arg, x))
    case 'bin': {
      const a = evaluate(node.left, x)
      const b = evaluate(node.right, x)
      switch (node.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          return a / b
        case '%':
          return a % b
        case '^':
          return a ** b
      }
    }
  }
}

/** Parse once, then sample. The convenience wrapper the renderer uses.
 *
 * Parsing per sample would be several hundred parses for one curve, and would report a syntax
 * error three hundred times instead of once.
 */
export function compile(src: string): (x: number) => number {
  const tree = parse(src)
  return (x: number) => evaluate(tree, x)
}
