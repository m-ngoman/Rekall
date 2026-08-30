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
      <button onClick={onCancel} className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">
        ← Back
      </button>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        CSV format: <span className="font-semibold text-[var(--text)]">DeckName,Subtopic,Front,Back</span> — with header row
      </p>

      <label className="mb-3 block cursor-pointer rounded-[16px] bg-[var(--bg-card)] p-7 text-center text-sm text-[var(--text-secondary)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
        Drop a .csv file here or click to browse
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      <div className="mb-3 text-center text-xs font-semibold text-[var(--text-secondary)]">— or paste CSV text —</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste CSV content here..."
        className="min-h-[140px] w-full rounded-[12px] bg-[var(--bg-card)] p-3.5 text-xs outline-none placeholder:text-[var(--text-secondary)]"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      />

      {error && (
        <div className="mt-3 rounded-2xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      <div className="mt-5 flex gap-2.5">
        <button
          onClick={handleImport}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-[oklch(0.99_0.005_90)] disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import →'}
        </button>
        <button onClick={onCancel} className="rounded-full bg-[var(--bg-card)] px-6 py-3 text-sm font-bold text-[var(--text-secondary)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
