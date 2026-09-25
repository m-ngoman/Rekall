export interface Deck {
  id: string
  name: string
  total: number
  due: number
  /** Every card not yet met, however many days the daily cap spreads them over. Not today's work:
   * that is `new_today`. */
  new: number
  /** The new cards today's study queue will still serve: the day's intake (the new-cards-per-day
   * setting, raised by an upcoming exam) less the cards already met today. With `due`, what is
   * left in the deck today. */
  new_today: number
  learned: number
  /** All linked exams are in the past: off the daily to-do, still studiable from the library. */
  exam_paused: boolean
  /** Soonest upcoming linked exam, exam day included. Null = none upcoming. Nothing on screen
   * reads it at the moment. */
  next_exam: { name: string; date: string } | null
}

export interface Exam {
  id: string
  name: string
  /** Calendar date, `YYYY-MM-DD`. Parse with parseISODate — `new Date(str)` would shift a day. */
  date: string
  deck_ids: string[]
}

/** A card as its owner sees it, answer included — for writing and managing cards, as opposed to
 * StudyCard, which withholds the answer until you've been graded. */
export interface Card {
  id: string
  subtopic: string | null
  question: string
  answer: string
  state: 'new' | 'learning' | 'review'
  reviews: number
  /** Question and answer may carry LaTeX, as on StudyCard. */
  is_math: boolean
}

export interface StudyCard {
  id: string
  subtopic: string | null
  question: string
  is_new: boolean
  /** Question and answer may carry LaTeX and should be rendered as maths. Set by the generator's
   * own classification — see Card.is_math on the backend for why it isn't inferred at render. */
  is_math: boolean
}

export interface StudyQueue {
  deck_id: string
  deck_name: string
  cards: StudyCard[]
  /** Started cards whose next review hasn't come round yet: what reviewing ahead would serve. */
  later: number
  /** New cards the day's intake is holding back for later days. With nothing `later` either, an
   * empty queue is a deck done for today rather than an empty deck. */
  waiting: number
}

/** One deck's share of one calendar day, from GET /api/dashboard/day. */
export interface DayDeck {
  id: string
  name: string
  cards: number
}

export interface ReviewResult {
  grade: number
  /** The grader's 1-5 rubric score, shown as "4/5". Null when self-assessed — there was no
   * rubric, only your own 1-4 rating. */
  score: number | null
  explanation: string
  state: 'new' | 'learning' | 'review'
  due: string
  reviews: number
  lapses: number
}

export interface ImportResult {
  decks_created: number
  cards_created: number
}

export interface Dashboard {
  reviewed_today: number
  goal_today: number
  streak_days: number
  /** What the study queues will still serve today, goal or no goal. With a daily goal set, it is
   * the only way to tell "goal met, cards still waiting" from "nothing left". */
  remaining_today: number
}

export type TutorPersonality = 'strict_socratic' | 'direct' | 'encouraging' | 'terse' | 'custom'

export interface TutorSession {
  id: string
  deck_id: string | null
  personality: TutorPersonality
  custom_prompt: string | null
  voice_id: string | null
}

/** One stored turn, as the server hands it back when a conversation is resumed.
 *
 * Narrower than the screen's own `Message`: attached photos were never persisted, and a graph
 * survives only as the prose trace the backend appended in its place. */
export interface TutorMessageOut {
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

/** What opening the tutor returns — the session plus whatever was already said in it. */
export interface TutorSessionStart {
  session: TutorSession
  messages: TutorMessageOut[]
  /** False for a brand-new conversation; the screen shows its starters instead of a transcript. */
  resumed: boolean
  /** Where compaction has reached, or null if this conversation was never compacted. Turns at
   * or before it are still shown in full — the tutor just holds them as a summary rather than
   * word for word. */
  summarized_through: string | null
}

export interface TutorVoice {
  id: string
  name: string
  description: string
  gender: string
  /** What you hear if you have never picked one. The picker highlights this rather than the
   * first row, which was only ever right by coincidence of ordering. */
  is_default: boolean
}

export interface TutorTurnResult {
  transcript: string
  reply: string
}

/** One word's real start/end time (seconds into that sentence's audio), from the synthesizer.
 * Empty for providers that can't report them — see synthesize_timed in the backend. */
export interface WordTiming {
  w: string
  s: number
  e: number
}

export type MemoryCategory = 'preference' | 'gap' | 'context' | 'custom'

export interface MemoryNote {
  id: string
  category: MemoryCategory
  content: string
  source: 'manual' | 'auto'
}

/** One line of the tutor's own profile of you — a recurring pattern, not a fact about one
 * week's material. Deleted by text rather than id: a line has no stable identity across a
 * rewrite, and the text is what gets recorded so it cannot be re-derived. */
export interface ProfileLine {
  section: string
  text: string
  sessions: number
  /** `YYYY-MM-DD` of the most recent thing that supported this. Parse with parseISODate. */
  latest: string
  /** Gone quiet, so it is no longer sent to the tutor. Still kept — if the pattern comes back the
   * next pass re-dates it and it returns on its own. */
  stale: boolean
}

export interface StudentProfile {
  lines: ProfileLine[]
  chars: number
  max_chars: number
}

export interface GeneratedCard {
  id: string
  subtopic: string | null
  question: string
  answer: string
  /** Question and answer may carry LaTeX, as on StudyCard. */
  is_math: boolean
}

export interface DroppedCard {
  question: string
  reason: string
}

export interface Note {
  id: string
  deck_id: string | null
  deck_name: string | null
  /** User-set name. Null means the UI shows `preview` instead — that's the fallback everywhere. */
  title: string | null
  /** `text` is a note typed in the app: no original file, the body is the note. */
  file_type: 'image' | 'pdf' | 'text'
  preview: string
  created_at: string
}

export interface NoteDetail extends Note {
  ocr_text: string | null
}

export interface GenerationResult {
  deck_id: string
  deck_name: string
  cards_added: GeneratedCard[]
  cards_dropped: DroppedCard[]
}

/** What can be sent to PATCH /settings. Mostly Settings, except `onboarded` — you write a
 * boolean and read back `onboarded_at`, a timestamp, so the two shapes genuinely differ. */
export type SettingsPatch = Partial<Settings> & { onboarded?: boolean }

export type Theme = 'system' | 'light' | 'dark'

export type GradingStrictness = 'lenient' | 'balanced' | 'strict'

export interface Settings {
  /** Null means first run — show onboarding. */
  onboarded_at: string | null
  theme: Theme
  /** Null means the app's default accent, not "no accent". */
  accent: string | null
  new_cards_per_day: number
  /** 0 = uncapped. */
  session_size: number
  /** 0 = derive the goal from whatever is actually due. */
  daily_goal: number
  grading_strictness: GradingStrictness
  /** Target recall probability, 80-95. Lower = longer gaps, fewer reviews, more forgetting. */
  fsrs_retention_pct: number
  /** Longest gap a card can be given, in days. 0 = uncapped. */
  fsrs_max_interval_days: number
  /** Percent, 50-200. Integer so it round-trips through JSON exactly. */
  tts_speed_pct: number
  /** Amplitude floor (0-255 scale) below which the client treats input as silence. */
  mic_sensitivity: number
  /** How long a pause ends your turn. */
  mic_silence_ms: number
  /** Hold the mic open until tapped again, instead of ending the turn on silence. */
  push_to_talk: boolean
  /** AI feature toggles. All default true. There is no master field — "off" is all four false,
   * and the master switch in Settings is derived from them so it can't disagree with them. */
  ai_grading: boolean
  ai_generation: boolean
  ai_tutor: boolean
  ai_voice: boolean
  /** Seeds new tutor conversations. Also written when you change either in the composer. */
  tutor_personality: TutorPersonality
  tutor_voice_id: string | null
  tutor_custom_prompt: string | null
  /** Lets the tutor write its own memory notes as you talk. Its notes are labelled and deletable. */
  tutor_auto_memory: boolean
}

/** One feature's row in the owner dashboard. `uses` counts times used; `items` counts what those
 * uses produced (cards generated, files uploaded) — equal for features that produce nothing
 * countable, which is why both are sent rather than one being inferred. */
export interface FeatureUsage {
  key: string
  label: string
  uses_day: number
  uses_week: number
  uses_month: number
  uses_total: number
  items_week: number
  items_total: number
  /** When this feature's counting started. Differs per feature — reviews and note uploads were
   * backfilled from existing rows, the rest began at the migration. Null = never used. */
  tracked_since: string | null
  /** Uses per day, index-aligned with `AdminStats.daily` — same length, same order. Feeds the
   * per-feature sparkline; the dates come from `daily`, not from here. */
  daily_uses: number[]
}

/** One feature's share of what the app costs to run. */
export interface SpendFeature {
  key: string
  label: string
  usd: number
  /** Share of window spend, 0-1. */
  share: number
  /** Index-aligned with `Spend.days`. */
  daily_usd: number[]
  /** True when no provider priced this and the figure is computed from config rates. Shown,
   * because a calculated number sitting beside billed ones reads as billed. */
  estimated: boolean
  calls: number
  tokens_in: number
  tokens_out: number
  tokens_cached: number
}

export interface Spend {
  /** `YYYY-MM-DD`, UTC. Parse with parseISODate. */
  days: string[]
  features: SpendFeature[]
  total_usd: number
  estimated_usd: number
  all_time_usd: number
  tracking_since: string | null
}

export interface DailyUsage {
  /** `YYYY-MM-DD`, UTC. Parse with parseISODate. */
  date: string
  uses: number
  active_users: number
  new_users: number
  /** Everyone registered as at the end of this day — already cumulative, including accounts made
   * before the window opened. */
  registered: number
}

/** Aggregates only — the endpoint behind this cannot return anything a user wrote or uploaded. */
export interface AdminStats {
  generated_at: string
  /** Oldest recorded event of any kind. Null when nothing has been recorded yet. */
  tracking_since: string | null
  users: {
    registered: number
    new_week: number
    new_month: number
    /** Distinct people who did any tracked thing in the window. */
    active: { day: number; week: number; month: number }
  }
  features: FeatureUsage[]
  /** What exists right now, as opposed to what was done — these fall when things are deleted. */
  library: { decks: number; cards: number; notes: number; tutor_sessions: number }
  daily: DailyUsage[]
}

export type ProductKind = 'subscription' | 'lifetime' | 'credits' | 'pages'

export interface CatalogueProduct {
  id: string
  label: string
  description: string
  kind: ProductKind
  /** Minor units — cents. */
  amount: number
  recurring: boolean
  credit_hours: number
  pages: number
}

export interface Catalogue {
  currency: string
  products: CatalogueProduct[]
}

export interface BillingStatus {
  text_ai: boolean
  text_ai_lifetime: boolean
  text_ai_expires_at: string | null
  voice_credits: number
  voice_hours: number
  /** Purchased pages on hand. Never expires. */
  generation_pages: number
  /** What's left of today's included allowance. Refills; not a balance. */
  generation_pages_today: number
  tier: string
}

export interface Me {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  tier: string
  /** True only for the account named by OWNER_EMAIL on the server. Gates the tutor's /bug
   * command; the endpoints behind it re-check it, so this is presentation only. */
  is_owner: boolean
}

export interface BugReport {
  id: string
  text: string
  created_at: string
  resolved_at: string | null
}
