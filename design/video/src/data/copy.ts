/** Every word the video adds to the app's own.
 *
 * Each line restates something the app or its README already says, and the source is noted beside
 * it: commit 50c7052 ("Say only what the app actually does") is why. Answers are typed, never
 * spoken — only the tutor listens — so nothing here says otherwise. src/__tests__/copy.test.ts holds
 * all of it to the design system's copy rules (design/design-system/README.md): sentence case, no
 * "·", no arrows, no all-caps, no prices. */
export const CAPTIONS = {
  /** og:title and twitter:title, frontend/index.html. */
  check: 'Flashcards that check your answer.',
  /** The README tagline, first half. */
  reads: 'It reads what you actually wrote.',
  /** The README tagline, second half. */
  missed: 'Then tells you what you missed.',
  /** StudyScreen's "Save for tutor", offered on a card you missed. */
  save: 'Save a missed card for the tutor.',
  /** Tutor voice mode. The tutor is the only thing in Rekall that listens. */
  talk: 'Talk it through with the tutor.',
  /** README: "an AI tutor … with persistent memory of what you keep getting wrong". */
  memory: 'It remembers what you keep getting wrong.',
  /** GenerateScreen: "Upload photos of your notes or a PDF, or pull from notes you've already saved." */
  notes: 'Turn your notes into cards.',
  /** GenerateScreen: "The AI drafts flashcards, then checks each one against your notes before adding it." */
  checked: 'Each card is checked against your notes.',
  /** HomeScreen: "Home is the countdown: the next exam, the days left, the cards due today, one button." */
  countdown: 'A countdown to your next exam.',
  /** ExamsScreen: "every day shows how many cards FSRS has put on it". */
  perDay: 'See how many cards land on each day.',
  /** ExamsScreen: "Linked decks pace their new cards to land before the date." Paced, never "guaranteed". */
  paced: 'New cards are paced to land before your exam.',
} as const

export type CaptionId = keyof typeof CAPTIONS

/** The end card: the wordmark as the sidebar sets it, the README's tagline, and the address. */
export const END_CARD = {
  wordmark: 'Rekall',
  tagline: 'Flashcards that read what you actually wrote, and tell you what you missed.',
  url: 'rekall.study',
} as const
