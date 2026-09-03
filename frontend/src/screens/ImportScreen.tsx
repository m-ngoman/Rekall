import { useState } from 'react'
import { importDeck } from '../api'

interface Props {
  onDone: () => void
  onCancel: () => void
}

export default function ImportScreen({ onDone, onCancel }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result))
    reader.readAsText(file)
  }

  const handleImport = async () => {
    if (!text.trim()) {
      setError('Paste some CSV text first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await importDeck(text)
      if (result.cards_created === 0) {
        setError('No valid cards found in CSV.')
        return
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button onClick={onCancel} className="-ml-2 mb-3 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
      <p className="mb-5 text-[0.9375rem] text-[var(--text-muted)]">
        One card per line, with a header row: <span className="font-semibold text-[var(--text)]">DeckName,Subtopic,Front,Back</span>
      </p>

      <label className="mb-3 block cursor-pointer rounded-[var(--r-md)] border border-dashed border-[var(--rule)] p-7 text-center text-[0.9375rem] font-semibold text-[var(--text-muted)]">
        Drop a .csv file here, or tap to choose one
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      <div className="mb-3 text-center text-[0.8125rem] text-[var(--text-muted)]">or paste the CSV text</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste CSV here"
        className="min-h-[140px] w-full rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3.5 text-[0.9375rem] placeholder:text-[var(--text-muted)]"
      />

      {error && (
        <div className="mt-3 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      <button
        onClick={handleImport}
        disabled={busy}
        className="on-accent mt-5 w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        {busy ? 'Importing' : 'Import these cards'}
      </button>
    </div>
  )
}
