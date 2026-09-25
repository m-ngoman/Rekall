import Notice from './Notice'

/** What a screen says when the data it runs on didn't arrive (see useCachedResource).
 *
 * Two sentences, because the two cases mean different things to the person reading them. With a
 * copy from earlier on screen, nothing is missing, it may just be out of date. With nothing
 * loaded at all, the screen has nothing true to show, so it says that rather than falling through
 * to its empty state: "no decks yet" is for a response that said so, not for one that never came.
 * Neutral, not error: a dropped request is not the user's mistake, and a red bar over their own
 * cards would read as something having gone wrong with them.
 */
export default function LoadNotice({
  stale,
  what,
  onRetry,
  className,
}: {
  /** An earlier copy is on screen. */
  stale: boolean
  /** What didn't load, for the nothing-loaded case: "your cards", "the calendar". */
  what: string
  onRetry: () => void
  className?: string
}) {
  return (
    <Notice tone="neutral" action={{ label: 'Retry', onClick: onRetry }} className={className}>
      {stale ? "Couldn't refresh just now. This is what was here before." : `Couldn't load ${what}.`}
    </Notice>
  )
}
