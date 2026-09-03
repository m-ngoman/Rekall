import { useEffect, useState } from 'react'
import { getMe, type Me } from './api'
import type { Tab } from './components/navIcons'
import DesktopSidebar from './components/DesktopSidebar'
import Logo from './components/Logo'
import TabBar from './components/TabBar'
import { DEFAULT_ACCENT } from './hooks/useAccent'
import { useSettings } from './hooks/useSettings'
import AdminScreen from './screens/AdminScreen'
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

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  // Not a tab: it's one account's screen, and a seventh destination in a six-item tab bar would
  // be crowding the layout for everyone else's benefit of never seeing it. Reached from Settings,
  // and left by any navigation — hence goToTab rather than setTab on the nav components.
  const [showAdmin, setShowAdmin] = useState(false)
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { settings, error: settingsError, update: updateSettings } = useSettings(DEFAULT_ACCENT)
  const blockedTabs: Tab[] = settings && !settings.ai_tutor ? ['tutor'] : []

  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('auth_error')
    if (err) {
      setAuthError(
        err === 'bad_state' ? 'That sign-in link expired. Please try again.' : "Sign-in didn't complete. Please try again.",
      )
      window.history.replaceState({}, '', window.location.pathname)
    }
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [tab, showAdmin])

  const goToTab = (next: Tab) => {
    setShowAdmin(false)
    setTab(next)
  }

  const exitStudy = () => {
    setStudyDeckId(null)
    setRefreshKey((k) => k + 1)
  }

  if (me === undefined) return null
  if (me === null) return <SignInScreen error={authError} />

  if (settings && settings.onboarded_at === null) {
    return (
      <div className="min-h-screen text-[var(--text)]">
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
      <div className="min-h-screen text-[var(--text)]">
        {/* Study is its own branch with no sidebar — the session is the whole screen. It needs a
            wider desktop cap than the tabbed shell's: the design lays it out as a ~750px card
            column beside a 360px rail with 72px between them, which simply doesn't fit in the
            max-w-xl this used to inherit at every width. */}
        <main className="mx-auto max-w-xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] lg:max-w-7xl lg:px-10">
          <StudyScreen deckId={studyDeckId} onExit={exitStudy} aiGrading={settings?.ai_grading ?? true} />
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen text-[var(--text)]">
      <DesktopSidebar active={tab} onChange={goToTab} disabled={blockedTabs} />

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-xl px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] lg:max-w-5xl lg:px-10 lg:pb-10">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Home has no title of its own: the countdown below is the headline. The wordmark
                  says whose countdown it is and nothing more. */}
              {showAdmin ? (
                <div className="truncate text-[1.375rem] font-bold tracking-tight lg:text-[1.75rem]">Admin</div>
              ) : tab === 'home' ? (
                // Phone only. The sidebar already carries the wordmark at desktop widths, and
                // the design draws no second one in the content area — it read as the page
                // having been labelled twice.
                <span className="flex items-center gap-2.5 lg:hidden">
                  <Logo size={22} />
                  <span className="text-[0.9375rem] font-bold text-[var(--text-muted)]">Rekall</span>
                </span>
              ) : (
                <div className="truncate text-[1.375rem] font-bold tracking-tight lg:text-[1.75rem]">{TAB_TITLES[tab]}</div>
              )}
            </div>
            {tab !== 'settings' && (
              <button
                onClick={() => goToTab('settings')}
                aria-label="Settings"
                className="-mr-3 flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)] lg:hidden"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <circle cx="15" cy="6" r="2.4" fill="var(--bg)" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <circle cx="9" cy="12" r="2.4" fill="var(--bg)" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                  <circle cx="17" cy="18" r="2.4" fill="var(--bg)" />
                </svg>
              </button>
            )}
          </div>
          <div key={showAdmin ? 'admin' : tab}>
            {showAdmin && <AdminScreen onBack={() => setShowAdmin(false)} />}
            {!showAdmin && tab === 'home' && (
              <HomeScreen key={refreshKey} onStudy={setStudyDeckId} onGoToCards={() => setTab('cards')} onOpenExams={() => setTab('calendar')} />
            )}
            {!showAdmin && tab === 'cards' && (
              <CardsScreen
                key={refreshKey}
                onStudy={setStudyDeckId}
                onChanged={() => setRefreshKey((k) => k + 1)}
                aiGeneration={settings?.ai_generation ?? true}
              />
            )}
            {/* Not keyed by refreshKey: its own saves bump the key (for Home/Cards), and a remount
                here would snap the month back to today and close the sheet mid-edit. */}
            {!showAdmin && tab === 'calendar' && <ExamsScreen onChanged={() => setRefreshKey((k) => k + 1)} />}
            {!showAdmin && tab === 'notes' && <NotesScreen onGoToCards={() => setTab('cards')} aiGeneration={settings?.ai_generation ?? true} />}
            {!showAdmin && tab === 'tutor' && <TutorScreen settings={settings} enterClass="" isOwner={me.is_owner} />}
            {!showAdmin && tab === 'settings' && (
              <SettingsScreen me={me} settings={settings} error={settingsError} onChange={updateSettings} onOpenAdmin={() => setShowAdmin(true)} />
            )}
          </div>
        </main>
      </div>

      <TabBar active={tab} onChange={goToTab} disabled={blockedTabs} />
    </div>
  )
}
