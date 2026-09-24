/** The backend, one module per area. Every call is re-exported here, so the app imports from
 * `api` and never needs to know which file a call lives in. Of the client, only what a screen
 * handles — the errors, and the server's sentence out of one — is re-exported. */

export { ApiError, NotSignedIn, PaymentRequired, TooManyRequests, serverDetail } from './client'
export * from './decks'
export * from './review'
export * from './tutor'
export * from './notes'
export * from './generation'
export * from './exams'
export * from './settings'
export * from './billing'
export * from './account'
