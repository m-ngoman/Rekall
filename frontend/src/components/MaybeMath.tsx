import { lazy, Suspense } from 'react'
import PlainMath from './PlainMath'

/** KaTeX is ~270kB of JS and its own stylesheet — far too much to put in front of every user for
 * a feature most decks and most conversations never touch. Loaded the first time maths actually
 * renders, the same way the notes editor is. */
const MathText = lazy(() => import('./MathText'))

/** Text that may carry LaTeX, with its maths set. Until the KaTeX chunk arrives it is the same text
 * minus the delimiters, so nothing flashes as markup while it loads. With `math` false the text is
 * shown exactly as written: a "$" in an ordinary card is a dollar sign, not a delimiter. */
export default function MaybeMath({ text, math = true }: { text: string; math?: boolean }) {
  if (!math) return <>{text}</>
  return (
    <Suspense fallback={<PlainMath text={text} />}>
      <MathText text={text} />
    </Suspense>
  )
}
