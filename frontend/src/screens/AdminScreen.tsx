import { useEffect, useState } from 'react'
import { getAdminStats } from '../api'
import BackButton from '../components/BackButton'
import Segmented from '../components/Segmented'
import type { AdminStats } from '../types'
import { formatDate, formatDayLong, formatNumber, plural } from '../components/admin/format'
import SectionTitle from '../components/admin/SectionTitle'
import StatTile from '../components/admin/StatTile'
import { PLOT_HEIGHT, TrendChart } from '../components/admin/charts'
import FeatureSection from '../components/admin/FeatureSection'
import DailyTable from '../components/admin/DailyTable'

interface Props {
  onBack: () => void
}

// Abbreviated to match the table's column heads, and because "30 days" wraps inside the pill.
const RANGES: { value: number; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

export default function AdminScreen({ onBack }: Props) {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // Cleared so a range switch shows the loading state rather than the old range's charts, which
    // would silently disagree with the range control for as long as the request takes.
    setStats(null)
    setError(null)
    getAdminStats(days)
      .then((s) => alive && setStats(s))
      // Not left on "Loading…" forever: this screen only exists for one account, so a failure
      // here has an audience of one and should say what happened.
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load stats.'))
    return () => {
      alive = false
    }
  }, [days])

  if (stats === null) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink onBack={onBack} />
        <p className="text-sm text-[var(--text-muted)]">{error ?? 'Loading…'}</p>
      </div>
    )
  }

  const { users, library, daily } = stats
  const rangeLabel = `${days} days`

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink onBack={onBack} />
        {/* One control for the whole page rather than one per chart: everything below plots the
            same window, and three copies of it would only invite them to disagree. */}
        <div className="w-[168px]">
          <Segmented options={RANGES} value={days} onChange={setDays} />
        </div>
      </div>

      <section>
        <SectionTitle>People</SectionTitle>
        {/* Two charts, never one with two lines: three people and five hundred events cannot share
            a y-axis, and the way round that is a second axis — which lets you draw any
            relationship you like between two series. Separate plots keep both honest. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChart
            title="Registered"
            daily={daily}
            value={(d) => d.registered}
            mark="area"
            headline={
              <>
                {plural(users.registered, 'account')}{' '}
                <span className="font-medium text-[var(--text-muted)]">
                  {users.new_month > 0
                    ? `, ${formatNumber(users.new_month)} new in 30 days`
                    : ', no new sign-ups in 30 days'}
                </span>
              </>
            }
            describe={(d) => (
              <>
                {formatDayLong(d.date)} —{' '}
                <span className="text-[var(--text-muted)]">
                  {plural(d.registered, 'account')}
                  {d.new_users > 0 && `, ${formatNumber(d.new_users)} new that day`}
                </span>
              </>
            )}
          />

          <TrendChart
            title="Active people"
            daily={daily}
            value={(d) => d.active_users}
            mark="line"
            headline={
              <>
                {plural(users.active.day, 'person', 'people')}{' '}
                <span className="font-medium text-[var(--text-muted)]">
                  today, {formatNumber(users.active.week)} this week, {formatNumber(users.active.month)} this
                  month
                </span>
              </>
            }
            describe={(d) => (
              <>
                {formatDayLong(d.date)} —{' '}
                <span className="text-[var(--text-muted)]">
                  {plural(d.active_users, 'person', 'people')} active
                </span>
              </>
            )}
          />
        </div>
        {/* "Active" is a definition, not a fact, so it says which one it means rather than leaving
            the chart to be read as whatever the reader assumes. */}
        <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
          Active means they reviewed a card, generated cards, uploaded notes or used the tutor —
          not merely that they were signed in.
        </p>
      </section>

      <section>
        <SectionTitle>Everything they did</SectionTitle>
        <TrendChart
          title="Uses"
          daily={daily}
          value={(d) => d.uses}
          mark="bars"
          plotHeight={PLOT_HEIGHT}
          headline={
            <>
              {plural(
                daily.reduce((sum, d) => sum + d.uses, 0),
                'use',
              )}{' '}
              <span className="font-medium text-[var(--text-muted)]">in {rangeLabel}</span>
            </>
          }
          describe={(d) => (
            <>
              {formatDayLong(d.date)} —{' '}
              <span className="text-[var(--text-muted)]">
                {plural(d.uses, 'use')}, {plural(d.active_users, 'person', 'people')}
              </span>
            </>
          )}
        />
        {/* Directly under the charts it tabulates. Left between sections it read as a stray
            control belonging to whichever heading happened to be above it. */}
        <div className="mt-4">
          <DailyTable daily={daily} />
        </div>
      </section>

      <FeatureSection features={stats.features} daily={daily} rangeLabel={rangeLabel} />

      <section>
        <SectionTitle>Library right now</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Decks" value={library.decks} />
          <StatTile label="Cards" value={library.cards} />
          <StatTile label="Notes" value={library.notes} />
          <StatTile label="Tutor sessions" value={library.tutor_sessions} />
        </div>
        {/* Numbers rather than charts here on purpose: these are a snapshot of what exists, and
            nothing records what existed last Tuesday, so a line would have to be invented. */}
        <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
          What exists at this moment — these fall when things are deleted, unlike everything above.
          There's no history behind them to plot.
        </p>
      </section>

      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Counts only. No card, note or conversation content is recorded for any of these numbers.
        {stats.tracking_since && ` Recording began ${formatDate(new Date(stats.tracking_since))}.`}
      </p>
    </div>
  )
}

function BackLink({ onBack }: Props) {
  return (
    <BackButton onClick={onBack}>Settings</BackButton>
  )
}
