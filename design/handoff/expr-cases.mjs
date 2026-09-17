// Cases for frontend/src/lib/expr.ts. There is no browser test runner in this repo — UI is
// verified with Playwright scripts in this directory — so the evaluator is checked the same way:
// a node script that imports the real module through Vite's TS pipeline and asserts.
//
//   cd frontend && npx vite-node ../design/handoff/expr-cases.mjs
//
// Falls back to a plain tsx/esbuild run if vite-node isn't available; see the npm script.
import { parse, evaluate, compile, ExprError } from '../../frontend/src/lib/expr.ts'

let failures = 0
// Infinities have to compare by identity: -Infinity - -Infinity is NaN, so subtraction says
// "not equal" for two values that are the same.
const near = (a, b) => {
  if (Number.isNaN(b)) return Number.isNaN(a)
  if (!Number.isFinite(b)) return a === b
  return Math.abs(a - b) < 1e-9
}

function ok(label, actual, expected) {
  const pass = near(actual, expected)
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  got ${actual}, want ${expected}`}`)
}

function throws(label, src) {
  let threw = false
  try {
    parse(src)
  } catch (e) {
    threw = e instanceof ExprError
  }
  if (!threw) failures += 1
  console.log(`${threw ? 'PASS' : 'FAIL'}  ${label}`)
}

const at = (src, x) => compile(src)(x)

console.log('--- precedence, the two traps ---')
// -x^2 is -(x^2), not (-x)^2. The classic plotting bug.
ok('-x^2 at x=3 is -9', at('-x^2', 3), -9)
ok('(-x)^2 at x=3 is 9', at('(-x)^2', 3), 9)
// ^ is right-associative: 2^3^2 is 2^9, not 8^2.
ok('2^3^2 is 512', at('2^3^2', 0), 512)
// A negative exponent needs the RHS of ^ to be a unary, not a factor.
ok('2^-1 is 0.5', at('2^-1', 0), 0.5)
ok('2^-x at x=2 is 0.25', at('2^-x', 2), 0.25)
ok('-2^2 is -4', at('-2^2', 0), -4)

console.log('\n--- ordinary arithmetic ---')
ok('2 + 3 * 4 is 14', at('2 + 3 * 4', 0), 14)
ok('(2 + 3) * 4 is 20', at('(2 + 3) * 4', 0), 20)
ok('10 / 4 is 2.5', at('10 / 4', 0), 2.5)
ok('7 % 3 is 1', at('7 % 3', 0), 1)
ok('x^2 - 4 at x=2 is 0', at('x^2 - 4', 2), 0)
ok('x^2 - 4 at x=-2 is 0', at('x^2 - 4', -2), 0)
ok('1e-3 is 0.001', at('1e-3', 0), 0.001)
ok('1.5e2 is 150', at('1.5e2', 0), 150)

console.log('\n--- implicit multiplication (models write it regardless) ---')
ok('2x at x=5 is 10', at('2x', 5), 10)
ok('3sin(0) is 0', at('3sin(0)', 0), 0)
ok('2(x+1) at x=3 is 8', at('2(x+1)', 3), 8)
ok('(x+1)(x-1) at x=3 is 8', at('(x+1)(x-1)', 3), 8)
ok('2pi is tau', at('2pi', 0), Math.PI * 2)
throws('xy is an error, not x times y', 'xy')

console.log('\n--- constants and every function ---')
ok('pi', at('pi', 0), Math.PI)
ok('e', at('e', 0), Math.E)
ok('2e is 2*E (not 2e0)', at('2e', 0), 2 * Math.E)
const fns = {
  'sin(1)': Math.sin(1), 'cos(1)': Math.cos(1), 'tan(1)': Math.tan(1),
  'asin(0.5)': Math.asin(0.5), 'acos(0.5)': Math.acos(0.5), 'atan(0.5)': Math.atan(0.5),
  'sinh(1)': Math.sinh(1), 'cosh(1)': Math.cosh(1), 'tanh(1)': Math.tanh(1),
  'sqrt(9)': 3, 'cbrt(27)': 3, 'abs(-3)': 3,
  'ln(e)': 1, 'log(100)': 2, 'exp(0)': 1,
  'floor(1.7)': 1, 'ceil(1.2)': 2, 'round(1.5)': 2, 'sign(-4)': -1,
}
for (const [src, want] of Object.entries(fns)) ok(src, at(src, 0), want)

console.log('\n--- unicode the model emits anyway ---')
ok('x − 1 (real minus) at x=4 is 3', at('x − 1', 4), 3)
ok('2 × x at x=3 is 6', at('2 × x', 3), 6)
ok('6 ÷ 2 is 3', at('6 ÷ 2', 0), 3)

console.log('\n--- non-finite samples come back as values, never throws ---')
ok('sqrt(-1) is NaN', at('sqrt(x)', -1), NaN)
ok('ln(0) is -Infinity', at('ln(x)', 0), -Infinity)
ok('1/0 is Infinity', at('1/x', 0), Infinity)
ok('0/0 is NaN', at('x/x', 0), NaN)
ok('tan near pi/2 is finite but huge', Number.isFinite(at('tan(x)', Math.PI / 2)), true)

console.log('\n--- min and max: the piecewise shapes ---')
// The reason these exist. Accelerate at 2 m/s^2 to 8 m/s, then cruise.
ok('min(2x, 8) still rising at x=2', at('min(2*x, 8)', 2), 4)
ok('min(2x, 8) levelled off at x=6', at('min(2*x, 8)', 6), 8)
ok('min at the kink itself', at('min(2*x, 8)', 4), 8)
ok('max(0, x) clamps below', at('max(0, x)', -3), 0)
ok('max(0, x) passes above', at('max(0, x)', 3), 3)
// Three phases: rise, cruise, fall. One expression, and the shape a kinematics question needs.
ok('max(0, min(2x, 8, 24 - 2x)) rising', at('max(0, min(2*x, 8, 24 - 2*x))', 3), 6)
ok('max(0, min(2x, 8, 24 - 2x)) cruising', at('max(0, min(2*x, 8, 24 - 2*x))', 7), 8)
ok('max(0, min(2x, 8, 24 - 2x)) braking', at('max(0, min(2*x, 8, 24 - 2*x))', 10), 4)
ok('spaces and nesting survive', at('min( x , max( 1 , 2 ) )', 5), 2)
ok('the abs identity agrees with min', at('(2*x + 8 - abs(2*x - 8))/2', 6), at('min(2*x, 8)', 6))
ok('implicit multiply before a call', at('2min(x, 3)', 5), 6)
// One argument is not an error — Math.min of one thing is that thing.
ok('min of one argument', at('min(x)', 7), 7)
throws('rejects a comma in a unary function', 'sin(x, 2)')
throws('rejects an empty argument list', 'min()')
throws('rejects a trailing comma', 'min(x,)')
throws('rejects a bare comma outside a call', 'x, 2')

console.log('\n--- garbage is a parse error, not a crash ---')
for (const bad of ['', '2 +', '(2', '2)', 'x +* 2', 'foo(x)', 'x $ 2', '2 @ 3', 'sin', 'sin x']) {
  throws(`rejects ${JSON.stringify(bad)}`, bad)
}

console.log('\n--- no code execution, ever ---')
for (const hostile of [
  'constructor', 'this', 'globalThis', 'process', 'require("fs")',
  'x.constructor', '[].constructor',
]) {
  throws(`rejects ${JSON.stringify(hostile)}`, hostile)
}

console.log('\n--- parse once, evaluate many ---')
const tree = parse('x^2')
ok('shared tree at x=2', evaluate(tree, 2), 4)
ok('shared tree at x=5', evaluate(tree, 5), 25)

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
