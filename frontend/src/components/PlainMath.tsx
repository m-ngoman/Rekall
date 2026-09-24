import { stripEmphasis } from '../lib/emphasis'

/** What to show for the instant before the KaTeX chunk arrives: the same text with the maths
 * delimiters taken out, which reads as an ordinary sentence rather than as markup. Kept apart
 * from MathText on purpose — importing that module pulls KaTeX in, and this is the fallback for
 * exactly the moment KaTeX hasn't loaded yet. */
export default function PlainMath({ text }: { text: string }) {
  return <>{stripEmphasis(text.replace(/\$\$?|\\[()[\]]/g, ''))}</>
}
