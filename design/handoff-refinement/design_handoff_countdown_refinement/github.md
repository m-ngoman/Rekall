repo: m-ngoman/Rekall
branch: main
path: frontend/src

## Last sync
date: 2026-09-16T20:17:45Z

### Updated in this project
- Recreated the shipped Countdown UI (Home, Cards, Calendar, Notes, Tutor, Settings, Study) as Current build.dc.html
- Built the refinement pass boards (Refined 1, Refined 2) and the Components delta from the same source
- tokens.css copied from the design system; tokens-v2.css holds only the changed light-theme values

## Screen map
| Screen | Repo files |
|---|---|
| Shell, header, nav | frontend/src/App.tsx, components/DesktopSidebar.tsx, components/TabBar.tsx, components/navIcons.tsx, components/Logo.tsx, index.css |
| Home | frontend/src/screens/HomeScreen.tsx, components/DeckTile.tsx, lib/dates.ts |
| Cards | frontend/src/screens/CardsScreen.tsx, components/ActionCard.tsx, components/DeckTile.tsx |
| Calendar | frontend/src/screens/ExamsScreen.tsx, components/ExamCalendar.tsx, lib/load.ts |
| Notes | frontend/src/screens/NotesScreen.tsx |
| Tutor | frontend/src/screens/TutorScreen.tsx, components/PersonalityPicker.tsx |
| Settings | frontend/src/screens/SettingsScreen.tsx, components/Segmented.tsx, hooks/useAccent.ts |
| Study | frontend/src/screens/StudyScreen.tsx |
