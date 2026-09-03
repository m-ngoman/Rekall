export interface Deck {
  id: string
  name: string
  total: number
  due: number
  new: number
  learned: number
  /** All linked exams are in the past: off the daily to-do, still studiable from the library. */
  exam_paused: boolean
  /** Soonest upcoming linked exam, for the countdown badge. Null = none upcoming. */
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
}

export interface StudyCard {
  id: string
  subtopic: string | null
  question: string
  is_new: boolean
}

export interface StudyQueue {
  deck_id: string
  deck_name: string
  cards: StudyCard[]
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
}

export type TutorPersonality = 'strict_socratic' | 'direct' | 'encouraging' | 'terse' | 'custom'

export interface TutorSession {
  id: string
  deck_id: string | null
  personality: TutorPersonality
  custom_prompt: string | null
  voice_id: string | null
}

export interface TutorVoice {
  id: string
  name: string
  description: string
  gender: string
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

export interface GeneratedCard {
  id: string
  subtopic: string | null
  question: string
  answer: string
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
