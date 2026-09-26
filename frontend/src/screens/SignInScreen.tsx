import Logo from '../components/Logo'

/**
 * The whole app when nobody is signed in.
 *
 * A full-page takeover rather than a modal over the UI: there is genuinely nothing behind it —
 * every endpoint returns 401 — and showing a greyed-out dashboard someone can't touch would imply
 * otherwise.
 */
export default function SignInScreen({ error }: { error: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-[var(--text)]">
      <div className="w-full max-w-sm rounded-[var(--r-md)] bg-[var(--surface)] px-7 py-12 text-center">
        <div className="mb-5 flex justify-center">
          <Logo size={92} />
        </div>
        <h1 className="mb-2 text-[1.375rem] font-bold tracking-tight">Rekall</h1>
        <p className="mx-auto mb-6 max-w-xs text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
          Flashcards that read what you actually wrote, and tell you what you missed.
        </p>

        {/* One graded answer, drawn the way the study screen draws it: the proof for the sentence
            above, before anyone is asked to sign in for it. Static on purpose. The page stays one
            card and one button; this is evidence, not a tour. */}
        <figure className="mb-8 rounded-[var(--r-md)] bg-[var(--bg)] px-4 py-3.5 text-left">
          <figcaption className="sr-only">An example of a graded answer</figcaption>
          <div className="text-[0.875rem] font-bold leading-snug [text-wrap:pretty]">
            Why does an SN1 reaction give a racemic mixture?
          </div>
          <div className="mt-2.5 text-[0.75rem] font-semibold text-[var(--text-muted)]">You wrote</div>
          <div className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--text-muted)]">
            You get a carbocation in the middle of the reaction.
          </div>
          <div className="mt-3 flex items-baseline gap-2" style={{ color: 'var(--grade-hard)' }}>
            <span className="flex items-baseline gap-0.5">
              <span className="numeral text-[1.75rem]">3</span>
              <span className="numeral text-[1rem] opacity-70">/5</span>
            </span>
            <span className="text-[0.8125rem] font-bold">Hard</span>
          </div>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed [text-wrap:pretty]">
            You missed why it matters: the carbocation is planar, so the nucleophile can attack
            either face equally.
          </p>
        </figure>

        {error && (
          <div
            className="mb-6 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}
          >
            {error}
          </div>
        )}

        {/* A plain link, not a fetch: this is a full-page navigation to Google and back. An
            XHR would be blocked by CORS and could not carry the browser's Google session. */}
        <a
          href="/api/auth/login"
          className="on-accent flex w-full items-center justify-center gap-2.5 rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M21.35 11.1h-9.17v2.96h5.26c-.23 1.37-1.6 4.02-5.26 4.02-3.17 0-5.75-2.62-5.75-5.85s2.58-5.85 5.75-5.85c1.8 0 3.01.77 3.7 1.43l2.52-2.43C16.8 3.8 14.72 2.9 12.18 2.9 6.9 2.9 2.63 7.17 2.63 12.45s4.27 9.55 9.55 9.55c5.51 0 9.16-3.87 9.16-9.32 0-.63-.07-1.1-.16-1.58z" />
          </svg>
          Continue with Google
        </a>

        <p className="mt-6 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
          By continuing you agree to the{' '}
          <a href="/terms.html" className="underline">Terms</a> and{' '}
          <a href="/privacy.html" className="underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}
