import type { PlotSpec } from '../../lib/plot'

/** A line of the conversation, as the log and the voice stage show it. */
export interface Message {
  /** 'system' is local-only — the app talking, not the tutor. Used by the owner-only /bug
   * commands, which never reach the model. */
  role: 'user' | 'assistant' | 'system'
  text: string
  imageUrl?: string
  /** Graphs the tutor drew with this reply.
   *
   * On the message rather than in sibling state like `examOffer`, because a graph belongs to the
   * reply that drew it. It also has to be here: `typeInto` writes into the *last* assistant
   * message every 20ms and bails if the last message isn't the assistant's, so a plot appended
   * as its own message would stop the reveal dead. The typewriter spreads `{ ...last }`, so a
   * field added here survives every tick. */
  plots?: PlotSpec[]
  /** A resumed turn where the student had attached a photo. The image itself was never stored,
   * so all that survives is the fact that there was one. */
  photoDropped?: boolean
  /** Graphs from a resumed turn, as the one-sentence traces the backend left in the transcript.
   * `plots` can't be rebuilt from those, so they render as muted captions instead. */
  captions?: string[]
}

/** A calendar entry the tutor has offered to add. `added` keeps the card in place afterwards so
 * the confirmation is visible rather than the row just vanishing. */
export interface ExamOffer {
  name: string
  date: string
  added: boolean
}

/** The composer's pickers. One is open at a time. */
export type Popover = 'personality' | 'voice' | 'memory' | 'photo'
