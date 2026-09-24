/** What a study session has counted so far. `total` is showings, so a card missed on its first
 * showing adds one for the second; `done` and `correct` are cards. */
export interface SessionStats {
  total: number
  done: number
  correct: number
}

/** A reported card is suspended on the server, so this session must not show it again either.
 * It still would if it had been missed first time: that puts it back in the queue for a second
 * showing. This takes any pending showing out of the queue, and out of the total it was counted
 * in. Inputs are left as they were. */
export function afterReport<C extends { id: string }>(queue: C[], stats: SessionStats, id: string): { queue: C[]; stats: SessionStats } {
  const rest = queue.filter((c) => c.id !== id)
  const removed = queue.length - rest.length
  return { queue: rest, stats: removed ? { ...stats, total: stats.total - removed } : stats }
}
