import { useEffect, useRef, useState } from 'react'
import { getMe, type Me } from './api'
import type { Tab } from './components/navIcons'
import DesktopSidebar from './components/DesktopSidebar'
import Logo from './components/Logo'
import TabBar from './components/TabBar'
import { DEFAULT_ACCENT } from './hooks/useAccent'
import { useSettings } from './hooks/useSettings'
import CardsScreen from './screens/CardsScreen'
import ExamsScreen from './screens/ExamsScreen'
import HomeScreen from './screens/HomeScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import SignInScreen from './screens/SignInScreen'
import NotesScreen from './screens/NotesScreen'
import SettingsScreen from './screens/SettingsScreen'
import StudyScreen from './screens/StudyScreen'
import TutorScreen from './screens/TutorScreen'

const TAB_TITLES: Record<Exclude<Tab, 'home'>, string> = {
  cards: 'Your Cards',
  calendar: 'Calendar',
  notes: 'Notes',
  tutor: 'Tutor',
  settings: 'Settings',
}

/** Left-to-right order of the destinations, used only to work out which way a switch travels.
 * Settings sits last because that's where its icon is in both the sidebar and the header. */
const TAB_ORDER: Tab[] = ['home', 'cards', 'calendar', 'notes', 'tutor', 'settings']

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  // Which way the last switch went, so the incoming screen enters from that side. Read during
  // render and updated after, so it describes the switch that just happened.
  const prevTabRef = useRef<Tab>('home')
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { settings, error: settingsError, update: updateSettings } = useSettings(DEFAULT_ACCENT)

  // `undefined` means "still asking", `null` means "asked, and nobody is signed in". Collapsing
  // those two into one value would flash the sign-in screen for a moment on every load.
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    // The OAuth callback redirects back with ?auth_error=... when something went wrong. Read it,
    // then strip it from the URL so a refresh doesn't resurrect a stale error.
    const params = new URLSearchParams(window.location.search)
    const err = params.get('auth_error')
    if (err) {
      setAuthError(
        err === 'bad_state'
          ? "That sign-in link expired. Please try again."
          : "Sign-in didn't complete. Please try again.",
      )
      window.history.replaceState({}, '', window.location.pathname)
    }
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  // Each tab is its own top-level view, so it should start at its own top. Without this the
  // scroll offset carried over and the browser clamped it when the new screen was shorter — which
  // is what the jump on every tab switch actually was.
  useEffect(() => {
    window.scrollTo(0, 0)
    prevTabRef.current = tab
  }, [tab])

  const exitStudy = () => {
    setStudyDeckId(null)
    setRefreshKey((k) => k + 1)
  }

  // Note: no bg-[var(--bg)] on any wrapper below — html owns the page background and a fixed
  // layer behind everything owns the accent glow (see index.css). An opaque --bg on a
  // min-h-screen wrapper paints straight over the glow.
  // Nothing is rendered until we know who this is: every endpoint 401s while signed out, so any
  // other screen would just be a shell full of failed requests.
  if (me === undefined) return null
  if (me === null) return <SignInScreen error={authError} />

  // Takes over the whole screen — no tab bar, no sidebar. A first run shouldn't offer navigation
  // to places that are all empty. Held until settings load so it can't flash on for one frame
  // for someone who onboarded months ago.
  if (settings && settings.onboarded_at === null) {
    return (
      <div className="min-h-screen font-sans text-[var(--text)]">
        <main className="mx-auto max-w-xl px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]">
          <OnboardingScreen
            settings={settings}
            onChange={updateSettings}
            onFinish={({ goToCards }) => {
              setTab(goToCards ? 'cards' : 'home')
              setRefreshKey((k) => k + 1)
            }}
          />
        </main>
      </div>
    )
  }

  if (studyDeckId) {
    return (
      <div className="min-h-screen font-sans text-[var(--text)]">
        <main className="mx-auto max-w-xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]">
          <StudyScreen deckId={studyDeckId} onExit={exitStudy} aiGrading={settings?.ai_grading ?? true} />
        </main>
      </div>
    )
  }

  const forward = TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(prevTabRef.current)
  const slideClass = forward ? 'tab-enter-right' : 'tab-enter-left'
  // The tutor screen animates itself instead of being animated by this wrapper. An animated
  // `transform` here would make this element a containing block for `position: fixed`
  // descendants, and the tutor's composer is fixed — for the length of the animation it would
  // hang off this wrapper rather than the viewport. TutorScreen applies the same class to its
  // log and its composer separately, which has no such effect.
  const wrapperClass = tab === 'tutor' ? undefined : slideClass

  return (
    <div className="flex min-h-screen font-sans text-[var(--text)]">
      <DesktopSidebar active={tab} onChange={setTab} />

      {/* min-w-0 is load-bearing: a flex item defaults to `min-width: auto`, so without it this
          column refuses to shrink below its content's min-content width — and any one descendant
          that can't get narrower stretches the whole page instead of overflowing on its own. On a
          phone that widens iOS's layout viewport, which zooms the page out and makes the fixed tab
          bar render at a different size per tab. This column should simply be the viewport. */}
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-xl px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[calc(1.75rem+env(safe-area-inset-top))] lg:max-w-5xl lg:px-10 lg:pb-10">
          <div className="mb-2 flex items-start justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Only on home. On the other tabs the heading names where you are, and a logo
                  beside it would be decoration competing with a label that has a job. */}
              {tab === 'home' && <Logo size={26} />}
              <div className="truncate text-[1.375rem] font-extrabold tracking-tight lg:text-[1.75rem]">
                {tab === 'home' ? greeting() : TAB_TITLES[tab]}
              </div>
            </div>
            {tab !== 'settings' && (
              <button
                onClick={() => setTab('settings')}
                aria-label="Settings"
                className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[var(--bg-card)] text-[var(--text-secondary)] lg:hidden"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <circle cx="15" cy="6" r="2.4" fill="var(--bg-card)" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <circle cx="9" cy="12" r="2.4" fill="var(--bg-card)" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                  <circle cx="17" cy="18" r="2.4" fill="var(--bg-card)" />
                </svg>
              </button>
            )}
          </div>
          <div key={tab} className={wrapperClass}>
          {tab === 'home' && (
            <HomeScreen
              key={refreshKey}
              onStudy={setStudyDeckId}
              onGoToCards={() => setTab('cards')}
              onOpenExams={() => setTab('calendar')}
            />
          )}
          {tab === 'cards' && <CardsScreen key={refreshKey} onStudy={setStudyDeckId} onChanged={() => setRefreshKey((k) => k + 1)} />}
          {/* Not keyed by refreshKey: its own saves bump the key (for Home/Cards), and a remount
              here would snap the month back to today and close the sheet mid-edit. */}
          {tab === 'calendar' && <ExamsScreen onChanged={() => setRefreshKey((k) => k + 1)} />}
          {tab === 'notes' && <NotesScreen onGoToCards={() => setTab('cards')} />}
          {tab === 'tutor' && <TutorScreen settings={settings} enterClass={slideClass} isOwner={me.is_owner} />}
          {tab === 'settings' && <SettingsScreen me={me} settings={settings} error={settingsError} onChange={updateSettings} />}
          </div>
        </main>
      </div>

      <TabBar active={tab} onChange={setTab} />
    </div>
  )
}
