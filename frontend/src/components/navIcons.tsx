export type Tab = 'home' | 'cards' | 'calendar' | 'notes' | 'tutor' | 'settings'

export const NAV_ITEMS: { id: Tab; label: string; icon: (color: string) => JSX.Element }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (color) => (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 11l10-8 10 8" />
        <path d="M4.5 10.5V19a1 1 0 0 0 1 1h4v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5h4a1 1 0 0 0 1-1v-8.5" />
      </svg>
    ),
  },
  {
    id: 'cards',
    label: 'Cards',
    icon: (color) => (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="3" width="14" height="14" rx="3" />
        <path d="M3 7v13a1 1 0 0 0 1 1h13" opacity="0.55" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (color) => (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4" />
        <circle cx="12" cy="15.5" r="1.1" fill={color} stroke="none" />
      </svg>
    ),
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: (color) => (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    id: 'tutor',
    label: 'Tutor',
    icon: (color) => (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        <circle cx="8.5" cy="10.5" r="1" fill={color} stroke="none" />
        <circle cx="12" cy="10.5" r="1" fill={color} stroke="none" />
        <circle cx="15.5" cy="10.5" r="1" fill={color} stroke="none" />
      </svg>
    ),
  },
]

export const SETTINGS_ICON = (color: string) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <circle cx="15" cy="6" r="2.4" fill="var(--bg-card)" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <circle cx="9" cy="12" r="2.4" fill="var(--bg-card)" />
    <line x1="3" y1="18" x2="21" y2="18" />
    <circle cx="17" cy="18" r="2.4" fill="var(--bg-card)" />
  </svg>
)
