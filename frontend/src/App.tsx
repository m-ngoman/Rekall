import { useEffect, useState } from 'react'
import { getMe } from './api'
import type { Me } from './types'
import type { Tab } from './lib/route'
import DesktopSidebar from './components/DesktopSidebar'
import Logo from './components/Logo'
import NodeLoader from './components/NodeLoader'
import TabBar from './components/TabBar'
import { DEFAULT_ACCENT } from './lib/accent'
import { useRoute } from './hooks/useRoute'
import { useBilling } from './hooks/useBilling'
import { useSettings } from './hooks/useSettings'
import AdminScreen from './screens/AdminScreen'
import CardsScreen from './screens/CardsScreen'
import ExamsScreen from './screens/ExamsScreen'
import HomeScreen from './screens/HomeScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import PricingScreen from './screens/PricingScreen'
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
  // One value for where we are, held in browser history — see hooks/useRoute. Admin and Pricing
  // are routes rather than tabs: each is a door you go through once, not somewhere you live, and
  // a seventh destination in a six-item tab bar would crowd the layout for everyone who never
  // sees it. Study is its own route because a session is a place you can be linked to and,
  // more to the point, a place the back gesture should return you from.
  const { route, go, replace } = useRoute()
  const tab: Tab = route.kind === 'tab' ? route.tab : 'home'
  const showAdmin = route.kind === 'admin'
  const showPricing = route.kind === 'pricing'
  const studyDeckId = route.kind === 'study' ? route.deckId : null
  const [refreshKey, setRefreshKey] = useState(0)
  const { settings, error: settingsError, update: updateSettings } = useSettings(DEFAULT_ACCENT)
  const blockedTabs: Tab[] = settings && !settings.ai_tutor ? ['tutor'] : []

  // Two independent reasons a feature can be off, ANDed here so every screen gets one boolean:
  // the user switched it off (settings), or it was never paid for (billing). Both resolve to the
  // same No-AI experience the app already has, which is the point — an unentitled account should
  // land in self-assessment review, not on a 402 with nowhere to go.
  //
  // `?? true` on both sides keeps the optimistic default the rest of this file uses: while either
  // request is in flight, assume on. The server's require_text_ai is the real gate, and study is
  // entered by tapping a deck, by which point both have long since landed.
  const { billing } = useBilling()
  const entitled = billing?.text_ai ?? true
  const aiGrading = (settings?.ai_grading ?? true) && entitled
  const aiGeneration = (settings?.ai_generation ?? true) && entitled

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
  }, [tab, showAdmin, showPricing])

  const goToTab = (next: Tab) => go({ kind: 'tab', tab: next })
  // Study is its own route; `go` leaving it is what makes the pricing screen reachable at all.
  const openPricing = () => go({ kind: 'pricing' })
  const openStudy = (deckId: string) => go({ kind: 'study', deckId })

  const exitStudy = () => {
    // `back`, not a push: leaving a session should undo the entry that started it, so the back
    // button doesn't drop you into the session you just finished.
    if (window.history.state && window.history.length > 1) window.history.back()
    else replace({ kind: 'tab', tab: 'home' })
    setRefreshKey((k) => k + 1)
  }

  // Admin is one account's screen. Landing on /admin without it is a correction, not a
  // navigation, so it replaces rather than pushes — back still goes where you came from.
  useEffect(() => {
    if (route.kind === 'admin' && me && !me.is_owner) replace({ kind: 'tab', tab: 'settings' })
  }, [route.kind, me, replace])

  // Signing in is a cookie check, usually over before the mark's delay is, so this is most often
  // nothing at all. On a slow start it is the mark rather than a blank page.
  if (me === undefined) return <NodeLoader label="Loading Rekall" className="flex min-h-[100dvh] items-center justify-center" />
  if (me === null) return <SignInScreen error={authError} />

  if (settings && settings.onboarded_at === null) {
    return (
      <div className="min-h-screen text-[var(--text)]">
        <main className="mx-auto max-w-xl px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]">
          <OnboardingScreen
            onChange={updateSettings}
            onFinish={({ goToCards, studyDeckId }) => {
              replace({ kind: 'tab', tab: goToCards ? 'cards' : 'home' })
              // The sample question is the point of the sample deck, so it opens straight into a
              // session, pushed over Home so that leaving the session lands there.
              if (studyDeckId) go({ kind: 'study', deckId: studyDeckId })
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
          <StudyScreen deckId={studyDeckId} onExit={exitStudy} aiGrading={aiGrading} aiTutor={settings?.ai_tutor ?? true} onOpenPricing={openPricing} />
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
                <div className="truncate text-[1.5rem] font-bold tracking-[-0.02em] lg:text-[1.75rem]">Admin</div>
              ) : showPricing ? (
                <div className="truncate text-[1.5rem] font-bold tracking-[-0.02em] lg:text-[1.75rem]">Plans</div>
              ) : tab === 'home' ? (
                // Phone only. The sidebar already carries the wordmark at desktop widths, and
                // the design draws no second one in the content area — it read as the page
                // having been labelled twice.
                <span className="flex items-center gap-2.5 lg:hidden">
                  <Logo size={22} />
                  <span className="text-[0.9375rem] font-bold text-[var(--text-muted)]">Rekall</span>
                </span>
              ) : (
                <div className="truncate text-[1.5rem] font-bold tracking-[-0.02em] lg:text-[1.75rem]">{TAB_TITLES[tab]}</div>
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
          <div key={showAdmin ? 'admin' : showPricing ? 'pricing' : tab}>
            {showAdmin && <AdminScreen onBack={() => goToTab('settings')} />}
            {showPricing && !showAdmin && <PricingScreen onBack={() => goToTab('settings')} />}
            {!showAdmin && !showPricing && tab === 'home' && (
              <HomeScreen
                key={refreshKey}
                onStudy={openStudy}
                onGoToCards={() => goToTab('cards')}
                onOpenExams={() => goToTab('calendar')}
                aiGrading={aiGrading}
              />
            )}
            {!showAdmin && !showPricing && tab === 'cards' && (
              <CardsScreen
                key={refreshKey}
                onStudy={openStudy}
                onChanged={() => setRefreshKey((k) => k + 1)}
                aiGeneration={aiGeneration}
                onOpenPricing={openPricing}
              />
            )}
            {/* Not keyed by refreshKey: its own saves bump the key (for Home/Cards), and a remount
                here would snap the month back to today and close the sheet mid-edit. */}
            {!showAdmin && !showPricing && tab === 'calendar' && <ExamsScreen onChanged={() => setRefreshKey((k) => k + 1)} />}
            {!showAdmin && !showPricing && tab === 'notes' && <NotesScreen onGoToCards={() => goToTab('cards')} aiGeneration={aiGeneration} />}
            {!showAdmin && !showPricing && tab === 'tutor' && <TutorScreen settings={settings} isOwner={me.is_owner} onOpenPricing={openPricing} />}
            {!showAdmin && !showPricing && tab === 'settings' && (
              <SettingsScreen me={me} settings={settings} error={settingsError} onChange={updateSettings} onOpenAdmin={() => go({ kind: 'admin' })} onOpenPricing={openPricing} />
            )}
          </div>
        </main>
      </div>

      <TabBar active={tab} onChange={goToTab} disabled={blockedTabs} />
    </div>
  )
}
