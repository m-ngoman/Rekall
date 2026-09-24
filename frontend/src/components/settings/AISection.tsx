import { useState } from 'react'
import type { Settings, SettingsPatch } from '../../types'
import { Row, Section, Toggle } from './controls'

/** The four AI toggles, behind one master switch.
 *
 * The master is derived (`anyOn`) rather than stored: a fifth boolean would be a second source of
 * truth for the same question and would eventually disagree with the four it claims to control.
 * Flipping it writes all four at once; the sub-toggles stay independently adjustable afterwards,
 * which is the point — "no AI" and "no AI except grading" are both positions people hold.
 *
 * Every one of these is enforced server-side too. A hidden button is a preference; someone who
 * turns AI off is entitled to a guarantee.
 */
export default function AISection({ settings, onChange }: { settings: Settings; onChange: (patch: SettingsPatch) => void }) {
  const anyOn = settings.ai_grading || settings.ai_generation || settings.ai_tutor || settings.ai_voice
  // Open when something is off, so a partial configuration is visible rather than hidden behind a
  // master switch that reads as a plain "on".
  const allOn = settings.ai_grading && settings.ai_generation && settings.ai_tutor && settings.ai_voice
  const [open, setOpen] = useState(!allOn)

  const setAll = (on: boolean) =>
    onChange({ ai_grading: on, ai_generation: on, ai_tutor: on, ai_voice: on })

  return (
    <Section title="AI features">
      <Row
        label="AI features"
        hint={anyOn ? 'Turn everything off in one go, then re-enable anything you want back.' : 'All AI is off. Cards are self-graded and made by hand.'}
      >
        <Toggle value={anyOn} onChange={setAll} />
      </Row>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-3.5 text-[0.9375rem] font-semibold"
      >
        {open ? 'Hide individual features' : 'Choose individually'}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'} />
        </svg>
      </button>

      {open && (
        <>
          <Row label="Card grading" hint="Off: you see the answer and rate your own recall, like paper flashcards.">
            <Toggle value={settings.ai_grading} onChange={(ai_grading) => onChange({ ai_grading })} />
          </Row>
          <Row label="Card generation & note text" hint="Off: no cards made from photos or PDFs, and photos aren't read into searchable text. Notes still upload and open normally, and you can still write cards yourself or import a CSV.">
            <Toggle value={settings.ai_generation} onChange={(ai_generation) => onChange({ ai_generation })} />
          </Row>
          <Row label="Tutor mode" hint="Off: the Tutor tab stops working. Nothing pretends to replace it.">
            <Toggle value={settings.ai_tutor} onChange={(ai_tutor) => onChange({ ai_tutor })} />
          </Row>
          <Row label="Voice mode" hint="Off: no speech in or out. Tutor mode still works by typing.">
            <Toggle value={settings.ai_voice} onChange={(ai_voice) => onChange({ ai_voice })} />
          </Row>
        </>
      )}
    </Section>
  )
}
