import { useRef, useState } from 'react'

/** Shared by "new category" and rename. Enter and blur commit, Escape abandons — blur-commits so
 * tapping away on a phone saves rather than silently discarding what was typed. */
export default function CategoryNameInput({
  initial = '',
  placeholder,
  onCommit,
  onCancel,
}: {
  initial?: string
  placeholder: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const committed = useRef(false)

  const commit = () => {
    if (committed.current) return
    committed.current = true
    const next = value.trim()
    if (next && next !== initial.trim()) onCommit(value)
    else onCancel()
  }

  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          committed.current = true
          onCancel()
        }
      }}
      className="mb-2.5 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold outline-none"
     
    />
  )
}
