import { describe, expect, it } from 'vitest'
import { compile, evaluate, ExprError, parse } from './expr'

// Infinities compare by identity: -Infinity - -Infinity is NaN, so subtraction would call two
// equal values different.
function near(actual: number, expected: number) {
  if (Number.isNaN(expected)) return expect(actual).toBeNaN()
  if (!Number.isFinite(expected)) return expect(actual).toBe(expected)
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}

const at = (src: string, x: number) => compile(src)(x)
const rejects = (src: string) => expect(() => parse(src)).toThrow(ExprError)

describe('precedence, the two traps', () => {
  it.each([
    ['-x^2', 3, -9], // -(x^2), not (-x)^2: the classic plotting bug
    ['(-x)^2', 3, 9],
    ['2^3^2', 0, 512], // right-associative
    ['2^-1', 0, 0.5], // a negative exponent needs the RHS of ^ to be a unary
    ['2^-x', 2, 0.25],
    ['-2^2', 0, -4],
  ])('%s at x=%d is %d', (src, x, want) => near(at(src, x), want))
})

describe('ordinary arithmetic', () => {
  it.each([
    ['2 + 3 * 4', 0, 14],
    ['(2 + 3) * 4', 0, 20],
    ['10 / 4', 0, 2.5],
    ['7 % 3', 0, 1],
    ['x^2 - 4', 2, 0],
    ['x^2 - 4', -2, 0],
    ['1e-3', 0, 0.001],
    ['1.5e2', 0, 150],
  ])('%s at x=%d is %d', (src, x, want) => near(at(src, x), want))
})

describe('implicit multiplication (models write it regardless)', () => {
  it.each([
    ['2x', 5, 10],
    ['3sin(0)', 0, 0],
    ['2(x+1)', 3, 8],
    ['(x+1)(x-1)', 3, 8],
    ['2pi', 0, Math.PI * 2],
  ])('%s at x=%d is %d', (src, x, want) => near(at(src, x), want))
  it('reads xy as an error, not x times y', () => rejects('xy'))
})

describe('constants and every function', () => {
  it.each([
    ['pi', Math.PI],
    ['e', Math.E],
    ['2e', 2 * Math.E], // 2*E, not 2e0
    ['sin(1)', Math.sin(1)],
    ['cos(1)', Math.cos(1)],
    ['tan(1)', Math.tan(1)],
    ['asin(0.5)', Math.asin(0.5)],
    ['acos(0.5)', Math.acos(0.5)],
    ['atan(0.5)', Math.atan(0.5)],
    ['sinh(1)', Math.sinh(1)],
    ['cosh(1)', Math.cosh(1)],
    ['tanh(1)', Math.tanh(1)],
    ['sqrt(9)', 3],
    ['cbrt(27)', 3],
    ['abs(-3)', 3],
    ['ln(e)', 1],
    ['log(100)', 2],
    ['exp(0)', 1],
    ['floor(1.7)', 1],
    ['ceil(1.2)', 2],
    ['round(1.5)', 2],
    ['sign(-4)', -1],
  ])('%s', (src, want) => near(at(src, 0), want))
})

describe('unicode the model emits anyway', () => {
  it.each([
    ['x − 1', 4, 3], // a real minus sign
    ['2 × x', 3, 6],
    ['6 ÷ 2', 0, 3],
  ])('%s at x=%d is %d', (src, x, want) => near(at(src, x), want))
})

describe('non-finite samples come back as values, never throws', () => {
  it('sqrt(-1) is NaN', () => near(at('sqrt(x)', -1), NaN))
  it('ln(0) is -Infinity', () => near(at('ln(x)', 0), -Infinity))
  it('1/0 is Infinity', () => near(at('1/x', 0), Infinity))
  it('0/0 is NaN', () => near(at('x/x', 0), NaN))
  it('tan near pi/2 is finite but huge', () => expect(Number.isFinite(at('tan(x)', Math.PI / 2))).toBe(true))
})

describe('min and max: the piecewise shapes', () => {
  // The reason these exist: accelerate at 2 m/s^2 to 8 m/s, then cruise.
  it.each([
    ['min(2*x, 8)', 2, 4],
    ['min(2*x, 8)', 6, 8],
    ['min(2*x, 8)', 4, 8], // at the kink itself
    ['max(0, x)', -3, 0],
    ['max(0, x)', 3, 3],
    // Rise, cruise, fall: one expression, the shape a kinematics question needs.
    ['max(0, min(2*x, 8, 24 - 2*x))', 3, 6],
    ['max(0, min(2*x, 8, 24 - 2*x))', 7, 8],
    ['max(0, min(2*x, 8, 24 - 2*x))', 10, 4],
    ['min( x , max( 1 , 2 ) )', 5, 2],
    ['2min(x, 3)', 5, 6], // implicit multiply before a call
    ['min(x)', 7, 7], // Math.min of one thing is that thing
  ])('%s at x=%d is %d', (src, x, want) => near(at(src, x), want))
  it('agrees with the abs identity', () => near(at('(2*x + 8 - abs(2*x - 8))/2', 6), at('min(2*x, 8)', 6)))
  it.each(['sin(x, 2)', 'min()', 'min(x,)', 'x, 2'])('rejects %s', rejects)
})

describe('garbage is a parse error, not a crash', () => {
  it.each(['', '2 +', '(2', '2)', 'x +* 2', 'foo(x)', 'x $ 2', '2 @ 3', 'sin', 'sin x'])('rejects %j', rejects)
})

describe('no code execution, ever', () => {
  it.each(['constructor', 'this', 'globalThis', 'process', 'require("fs")', 'x.constructor', '[].constructor'])(
    'rejects %j',
    rejects,
  )
})

describe('parse once, evaluate many', () => {
  it('shares a tree', () => {
    const tree = parse('x^2')
    near(evaluate(tree, 2), 4)
    near(evaluate(tree, 5), 25)
  })
})
