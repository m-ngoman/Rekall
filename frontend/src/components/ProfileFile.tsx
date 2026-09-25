import { useEffect, useRef, useState } from 'react'
import { ApiError, getStudentProfile, saveStudentProfile } from '../api'
import { errorMessage } from '../lib/errors'
import { lineEvidence, rebaseEdit } from '../lib/profile'
import type { StudentProfile } from '../types'
import Notice from './Notice'

interface Props {
  /** Null while it loads. */
  profile: StudentProfile | null
  /** It didn't load, and there is nothing to show. */
  failed?: boolean
  /** A save, or a reload after the tutor changed the file, hands the new version up. */
  onChange: (profile: StudentProfile) => void
  /** Whether the tutor is adding to the file ("Let the tutor remember"), for the empty state. */
  autoMemory?: boolean
  /** The popover above the tutor's composer is narrow; Settings has the page's width. */
  compact?: boolean
}

/** An edit in progress: the text in the box, and the version it was started from. */
interface Draft {
  text: string
  /** The file as it was when editing started, so a save that finds a newer version can carry
   * the edit over to it rather than throw it away. */
  base: string
  /** Sent with the save. Held here rather than read off `profile` at save time: the file can be
   * reloaded while the box is open, and the edit must still name the version it was made on. */
  rev: number
}

const MOVED_ON =
  'Your profile changed since you opened it, so this wasn’t saved yet. Your edit is now on the latest version: check it, then save.'

/**
 * What the tutor remembers about you, as one file you can read and edit.
 *
 * It used to be two lists in one panel: what the tutor had noticed, above notes you had written
 * it. Now there is one document, and the tutor reads what you see, less any line that has gone
 * quiet. Its own lines carry a quiet count of the sessions it saw them in; yours carry nothing,
 * and it can't change them.
 *
 * Editing is the whole file as plain text, headings included. The server keeps track of which
 * lines are whose: a tutor line you leave untouched stays the tutor's, one you reword becomes
 * yours, and one you take out is gone for good, because the server remembers you removed it.
 */
export default function ProfileFile({ profile, failed = false, onChange, autoMemory = true, compact = false }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = draft !== null
  const editButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  // Back to Edit once the box closes, rather than leaving focus on nothing.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      editButton.current?.focus()
    }
  }, [editing])

  const startEditing = () => {
    if (!profile) return
    setError(null)
    setDraft({ text: profile.text, base: profile.text, rev: profile.rev })
  }

  const stopEditing = () => {
    returnFocus.current = true
    setDraft(null)
  }

  const reload = async () => {
    setError(null)
    try {
      onChange(await getStudentProfile())
    } catch (e) {
      setError(errorMessage(e, "Couldn't load your profile."))
    }
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      onChange(await saveStudentProfile(draft.text, draft.rev))
      stopEditing()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Saved over, the old edit would take out whatever the tutor wrote since, and mark it
        // removed for good. So the edit moves onto the latest version, for another look.
        try {
          const latest = await getStudentProfile()
          onChange(latest)
          const sections = latest.sections.map((s) => s.name)
          setDraft({ text: rebaseEdit(draft.base, draft.text, latest.text, sections), base: latest.text, rev: latest.rev })
          setError(MOVED_ON)
        } catch {
          setError('Your profile changed since you opened it, and the latest version didn’t load. Your edit is still here: try saving again in a moment.')
        }
      } else {
        setError(errorMessage(e, "Couldn't save your profile."))
      }
    } finally {
      setSaving(false)
    }
  }

  const empty = profile !== null && profile.sections.every((s) => s.lines.length === 0)
  const text = compact ? 'text-xs' : 'text-[0.875rem]'

  return (
    <div className="flex flex-col">
      {error && (
        <Notice tone={error === MOVED_ON ? 'neutral' : 'error'} className="mb-3 text-xs">
          {error}
        </Notice>
      )}

      {draft ? (
        <>
          <textarea
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            // What is typed while a save is in flight would be dropped when it lands.
            readOnly={saving}
            autoFocus
            aria-label="Your profile"
            spellCheck
            rows={compact ? 10 : 14}
            className={`w-full resize-y rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2.5 font-mono leading-relaxed ${compact ? 'text-[0.6875rem]' : 'text-[0.8125rem]'}`}
          />
          <p className="mt-1.5 text-[0.6875rem] text-[var(--text-muted)]">
            One line each, under its heading. Lines you add or reword are yours: the tutor won't change them. Take out one of its lines and it won't put it back.
          </p>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setError(null)
                stopEditing()
              }}
              disabled={saving}
              className="min-h-9 rounded-[var(--r-full)] px-3.5 text-xs font-semibold text-[var(--text-muted)]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="on-accent min-h-9 rounded-[var(--r-full)] px-4 text-xs font-bold disabled:opacity-50"
            >
              {saving ? 'Saving' : 'Save'}
            </button>
          </div>
        </>
      ) : profile === null ? (
        failed ? (
          <div className="flex flex-col items-start gap-2">
            <p className={`${text} text-[var(--text-muted)]`}>Couldn't load your profile.</p>
            <button
              onClick={reload}
              className="min-h-9 rounded-[var(--r-full)] border border-[var(--rule)] px-3.5 text-xs font-bold text-[var(--text)]"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className={`${text} text-[var(--text-muted)]`}>Loading…</p>
        )
      ) : (
        <>
          {empty ? (
            <p className={`${text} leading-relaxed text-[var(--text-muted)]`}>
              {autoMemory
                ? 'The tutor writes here once it sees the same thing in two sessions. You can add to it yourself.'
                : 'Nothing here yet, and the tutor isn’t adding to it: "Let the tutor remember" is off in Settings. You can write in it yourself.'}
            </p>
          ) : (
            <div className={`flex flex-col gap-3 overflow-y-auto ${compact ? 'max-h-72' : ''}`}>
              {profile.sections
                .filter((s) => s.lines.length > 0)
                .map((section) => (
                  <section key={section.name}>
                    <h3 className="mb-1 text-[0.6875rem] font-bold text-[var(--text-muted)]">{section.name}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {section.lines.map((line, i) => {
                        const evidence = lineEvidence(line)
                        return (
                          // By position: nothing stops the tutor writing a line you also wrote.
                          <li key={i} style={{ opacity: line.stale ? 0.55 : 1 }}>
                            <div className={`${text} leading-relaxed text-[var(--text)]`}>{line.text}</div>
                            {evidence && <div className="text-[0.625rem] text-[var(--text-muted)]">{evidence}</div>}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
            </div>
          )}
          {profile.chars > profile.max_chars && (
            // Only notes carried over from before the profile can leave it this long: an edit
            // can't grow it past the limit, and the tutor won't write past it.
            <p className="mt-3 text-[0.6875rem] leading-snug text-[var(--text-muted)]">
              This is longer than the tutor can keep up to date. It still reads it, but won't add anything new until it's shorter.
            </p>
          )}
          <button
            ref={editButton}
            onClick={startEditing}
            className="mt-3 min-h-9 self-start rounded-[var(--r-full)] border border-[var(--rule)] px-3.5 text-xs font-bold text-[var(--text)]"
          >
            {empty ? 'Write something' : 'Edit'}
          </button>
        </>
      )}
    </div>
  )
}
