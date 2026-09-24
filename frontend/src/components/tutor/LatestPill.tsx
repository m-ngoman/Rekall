const LATEST_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
)

/** The way back to a reply still growing below you. It slides down *behind* the composer
 * rather than fading: the card below is opaque and comes later in the DOM, so it simply
 * covers this. That needs the card to be positioned too — otherwise this absolute box
 * paints above a static sibling regardless of order, which is why the card is
 * `relative`. Shown whenever the reader is away from the newest line, streaming or not.
 * Gating it on "a reply is in flight" was tried and is wrong: that flag follows the
 * network, and the typewriter keeps growing the log for a while after the wire closes,
 * so the pill parked itself with text still arriving underneath. "Is there something
 * below you" is both the simpler question and the one worth answering. */
export default function LatestPill({ away, onClick }: { away: boolean; onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-0 right-0 flex justify-center">
      <button
        onClick={onClick}
        aria-label="Jump to the newest message"
        aria-hidden={!away}
        tabIndex={away ? 0 : -1}
        className={`latest-pill mb-2 flex h-9 items-center gap-1.5 rounded-[var(--r-full)] border border-[var(--rule)] bg-[var(--surface)] px-3.5 text-[0.8125rem] font-bold ${
          away ? 'pointer-events-auto' : 'translate-y-[calc(100%+1.5rem)]'
        }`}
      >
        {LATEST_ICON}
        Latest
      </button>
    </div>
  )
}
