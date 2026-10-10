/** useRevealText: one character every 28 ms, which is roughly the speed someone talks. */
export const REVEAL_TICK_MS = 28

export function revealedAt(ms: number, text: string): string {
  if (ms < 0) return ''
  return text.slice(0, Math.min(text.length, Math.floor(ms / REVEAL_TICK_MS)))
}
