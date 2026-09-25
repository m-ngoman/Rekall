import { useState } from 'react'
import { ApiError, getStudentProfile, saveStudentProfile } from '../api'
import { errorMessage } from '../lib/errors'
import { lineEvidence } from '../lib/profile'
import type { StudentProfile } from '../types'
import Notice from './Notice'

interface Props {
  /** Null while it loads. */
  profile: StudentProfile | null
  /** It didn't load, and there is nothing to show. */
  failed?: boolean
  /** A save, or a reload after the tutor changed the file, hands the new version up. */
  onChange: (profile: StudentProfile) => void
  /** The popover above the tutor's composer is narrow; Settings has the page's width. */
  compact?: boolean
}

/**
 * What the tutor remembers about you, as one file you can read and edit.
 *
 * It used to be two lists in one panel: what the tutor had noticed, above notes you had written
 * it. Now there is one document, and the tutor reads exactly what you see. Its own lines carry a
 * quiet count of the sessions it saw them in; yours carry nothing, and it can't change them.
 *
 * Editing is the whole file as plain text, headings included. The server keeps track of which
 * lines are whose: a tutor line you leave untouched stays the tutor's, one you reword becomes
 * yours, and one you take out is gone for good, because the server remembers you removed it.
 */
export default function ProfileFile({ profile, failed = false, onChange, compact = false }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = draft !== null

  const startEditing = () => {
    if (!profile) return
    setError(null)
    setDraft(profile.text)
  }

  const save = async () => {
    if (!profile || draft === null) return
    setSaving(true)
    setError(null)
    try {
      onChange(await saveStudentProfile(draft, profile.rev))
      setDraft(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The tutor rewrote the file while this was open. Saving the draft over it would take
        // out whatever it just added, and mark those lines removed for good, so the latest
        // version replaces the draft and the edit is made again on top of it.
        try {
          const latest = await getStudentProfile()
          onChange(latest)
          setDraft(latest.text)
        } catch {
          setDraft(null)
        }
      }
      setError(errorMessage(e, "Couldn't save your profile."))
    } finally {
      setSaving(false)
    }
  }

  const empty = profile !== null && profile.sections.every((s) => s.lines.length === 0)
  const text = compact ? 'text-xs' : 'text-[0.875rem]'

  return (
    <div className="flex flex-col">
      {error && (
        <Notice tone="error" className="mb-3 text-xs">
          {error}
        </Notice>
      )}

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Your profile"
            spellCheck
            rows={compact ? 12 : 14}
            className={`w-full resize-y rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2.5 font-mono leading-relaxed ${compact ? 'text-[0.6875rem]' : 'text-[0.8125rem]'}`}
          />
          <p className="mt-1.5 text-[0.6875rem] text-[var(--text-muted)]">
            One line each, under its heading. Lines you add or reword are yours: the tutor won't change them. Take out any of its lines and it won't write them again.
          </p>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setDraft(null)
                setError(null)
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
        <p className={`${text} text-[var(--text-muted)]`}>{failed ? "Couldn't load your profile." : 'Loading…'}</p>
      ) : (
        <>
          {empty ? (
            <p className={`${text} leading-relaxed text-[var(--text-muted)]`}>
              The tutor writes here once it sees the same thing in two sessions. You can add to it yourself.
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
          <button
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
