import { formatNumber } from './format'

/** The display face, like every other headline number in the app. */
export default function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--r-md)] bg-[var(--surface)] p-4">
      <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{label}</div>
      <div className="numeral mt-1.5 text-[2rem]">{formatNumber(value)}</div>
    </div>
  )
}
