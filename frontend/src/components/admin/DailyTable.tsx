import type { DailyUsage } from '../../types'
import { formatDayLong, formatNumber } from './format'

/** One table for all three charts above, rather than a collapsible table under each. Their
 * `aria-label`s describe the shape; this is what makes the actual values reachable without a
 * pointer — on a touch device, or by a screen reader. */
export default function DailyTable({ daily }: { daily: DailyUsage[] }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-bold text-[var(--text-muted)]">
        Show daily numbers
      </summary>
      <div
        className="mt-3 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]"
      >
        <table className="w-full text-xs tabular-nums">
          <thead className="text-[var(--text-muted)]">
            <tr>
              <th className="px-4 pb-2 pt-4 text-left font-bold">Day</th>
              <th className="px-2 pb-2 pt-4 text-right font-bold">Registered</th>
              <th className="px-2 pb-2 pt-4 text-right font-bold">Active</th>
              <th className="px-4 pb-2 pt-4 text-right font-bold">Uses</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className="border-t border-[var(--rule)]">
                <td className="px-4 py-2">{formatDayLong(d.date)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(d.registered)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(d.active_users)}</td>
                <td className="px-4 py-2 text-right">{formatNumber(d.uses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
