import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { watchDynamicType } from './lib/dynamicType'
import './index.css'

// iOS Safari only applies :active while a touch listener exists somewhere up the tree — without
// one, the press styles in index.css would silently never fire on a phone. Passive and empty on
// purpose: its existence is the entire point, not what it does.
document.addEventListener('touchstart', () => {}, { passive: true })

// Keeps --text-scale in step with the iPhone's Text Size setting. The first measurement already
// happened in index.html's boot script (before paint); this one takes over for changes made
// while the app is open.
watchDynamicType()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
