import { useEffect, useState } from 'react'
import { getBillingStatus, getCatalogue, startCheckout, type BillingStatus, type Catalogue, type CatalogueProduct, type ProductKind } from '../api'

interface Props {
  onBack: () => void
}

const BACK_CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

/** Section order and headings are the only things this screen knows in advance. Which products
 * fall under each, and what they cost, arrive from the server — so the screen stays correct
 * through a price change, a renamed plan, or a new pack without being touched. */
const GROUPS: { kind: ProductKind; title: string }[] = [
  { kind: 'subscription', title: 'Monthly' },
  { kind: 'lifetime', title: 'Once' },
  { kind: 'credits', title: 'Voice' },
]

/** The server's own sentence for a failed checkout, if it sent one.
 *
 * request() folds a non-2xx body into the thrown message as `503 Service Unavailable: {"detail":
 * "..."}`. The status prefix is noise to a person, but the detail is exactly the sentence worth
 * showing — the server refusing to sell what it can't deliver says so in plain words, and
 * replacing that with a generic "try again" would hide the one thing the user needs to know. */
function serverDetail(e: unknown): string | null {
  if (!(e instanceof Error)) return null
  const m = e.message.match(/"detail":"((?:[^"\\]|\\.)*)"/)
  return m ? m[1].replace(/\\"/g, '"') : null
}

function price(amount: number, currency: string, recurring: boolean): string {
  const whole = amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2)
  return `$${whole} ${currency.toUpperCase()}${recurring ? '/mo' : ''}`
}

export default function PricingScreen({ onBack }: Props) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buying, setBuying] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getCatalogue(), getBillingStatus()])
      .then(([c, s]) => {
        setCatalogue(c)
        setStatus(s)
      })
      .catch(() => setError("Couldn't load plans right now."))
  }, [])

  const buy = async (product: CatalogueProduct) => {
    setBuying(product.id)
    setError(null)
    try {
      const { url } = await startCheckout(product.id)
      // Stripe hosts the payment page. Nothing about the card ever reaches this app.
      window.location.href = url
    } catch (e) {
      setError(serverDetail(e) ?? (e instanceof Error && !/^\d{3}\s/.test(e.message) ? e.message : "Couldn't start checkout. Try again in a moment."))
      setBuying(null)
    }
  }

  // Friends ride free by design; a plan would buy them nothing they don't already have.
  const absorbed = status?.tier === 'friend'

  return (
    <div>
      <button onClick={onBack} className="-ml-2 mb-3 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]">
        {BACK_CHEVRON}
        Back
      </button>

      <div className="mb-1 text-[1.25rem] font-bold">Rekall AI</div>
      <p className="mb-6 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
        The app is free. AI grading, cards from your notes, and the tutor are what a plan turns on. Voice is
        bought by the hour and never expires.
      </p>

      {status && (
        <div className="mb-6 rounded-[var(--r-md)] bg-[var(--surface)] px-4 [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
          <div className="flex items-baseline justify-between gap-4 py-3.5">
            <span className="text-[0.9375rem] font-semibold">Rekall AI</span>
            <span className="text-[0.875rem] text-[var(--text-muted)]">
              {absorbed ? 'Included' : status.text_ai_lifetime ? 'Yours, forever' : status.text_ai ? 'Active' : 'Not active'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3.5">
            <span className="text-[0.9375rem] font-semibold">Voice</span>
            <span className="text-[0.875rem] text-[var(--text-muted)]">
              {absorbed ? 'Included' : `${status.voice_hours} h left`}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      {catalogue &&
        GROUPS.map(({ kind, title }) => {
          const items = catalogue.products.filter((p) => p.kind === kind)
          if (items.length === 0) return null
          return (
            <section key={kind} className="mb-6">
              <div className="mb-2 text-[0.9375rem] font-bold">{title}</div>
              <div className="rounded-[var(--r-md)] bg-[var(--surface)] px-4 [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
                {items.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2.5 py-3.5">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[0.9375rem] font-bold">{p.label}</span>
                      <span className="numeral flex-shrink-0 text-[1.25rem]">{price(p.amount, catalogue.currency, p.recurring)}</span>
                    </div>
                    <p className="text-[0.8125rem] leading-snug text-[var(--text-muted)]">{p.description}</p>
                    <button
                      onClick={() => buy(p)}
                      disabled={absorbed || buying !== null}
                      className="on-accent self-start rounded-[var(--r-full)] bg-[var(--accent)] px-5 py-2.5 text-[0.875rem] font-bold disabled:opacity-50"
                    >
                      {buying === p.id ? 'Opening checkout' : p.recurring ? 'Subscribe' : 'Buy'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )
        })}

      {absorbed && (
        <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
          Your account is on the friends tier, so all of this is already switched on for you.
        </p>
      )}
    </div>
  )
}
