/** Emphasis parsing, with the streaming and maths-adjacency cases that make it non-obvious.
 *
 * The regex has enough lookaround in it that "obviously correct" is not a claim worth making
 * without checking.
 */

import { describe, expect, it } from 'vitest'
import { EMPHASIS, isBold, stripEmphasis, unwrapEmphasis } from './emphasis'

function segments(text: string): string[] {
  // Odd indices are matches, as the renderer relies on.
  return text.split(EMPHASIS).filter((_, i) => i % 2 === 1)
}

function check(label: string, actual: unknown, expected: unknown) {
  it(label, () => expect(actual).toEqual(expected))
}

describe('emphasis', () => {
  check('bold is matched', segments('the **carbocation** is planar'), ['**carbocation**'])
  check('italic is matched', segments('it is *planar* here'), ['*planar*'])
  check('bold unwraps', unwrapEmphasis('**x**'), 'x')
  check('italic unwraps', unwrapEmphasis('*x*'), 'x')
  check('bold is distinguished', [isBold('**x**'), isBold('*x*')], [true, false])
  check('both in one line', segments('**bold** and *italic*'), ['**bold**', '*italic*'])

  // Streaming: every prefix of a reply passes through the renderer on a 20ms tick, and a partial
  // marker must stay literal rather than flashing.
  for (const partial of ['the **', 'the **car', 'the **carbocation*', 'a *pla']) {
    check(`streaming prefix stays literal: ${JSON.stringify(partial)}`, segments(partial), [])
  }
  check('bold completes only when closed', segments('the **carbocation**'), ['**carbocation**'])

  // Multiplication must not become italics. This is the whole reason for the no-inner-whitespace rule.
  check('spaced asterisks are not emphasis', segments('2 * 3 * 4'), [])
  check('leading space rejected', segments('a * b*'), [])

  // Newline-bounded, so an unclosed marker cannot swallow the rest of a reply.
  check('does not span a newline', segments('**open\nstill going**'), [])

  // Underscores are subscripts in this app, never emphasis.
  check('underscores are untouched', segments('a_1 + b_2 and _not italic_'), [])

  check('stripEmphasis removes markers', stripEmphasis('the **carbocation** is *planar*'), 'the carbocation is planar')
  check('stripEmphasis leaves partials alone', stripEmphasis('the **carbo'), 'the **carbo')
})
