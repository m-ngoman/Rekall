/** Decks and their cards, as the library manages them. */

import type { Card, Dashboard, Deck, ImportResult } from '../types'
import { request } from './client'

export function listDecks(): Promise<Deck[]> {
  return request('/decks')
}

export function getDashboard(): Promise<Dashboard> {
  return request('/dashboard')
}

export function importDeck(csv: string): Promise<ImportResult> {
  return request('/decks/import', { method: 'POST', body: JSON.stringify({ csv }) })
}

/** Creates an empty deck. The Notes tab calls this "new category" — same object either way, which
 * is what keeps a note linked to the cards generated from it. */
export function createDeck(name: string): Promise<Deck> {
  return request('/decks', { method: 'POST', body: JSON.stringify({ name }) })
}

export function renameDeck(deckId: string, name: string): Promise<Deck> {
  return request(`/decks/${deckId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function deleteDeck(deckId: string): Promise<void> {
  return request(`/decks/${deckId}`, { method: 'DELETE' })
}

/** Every card in a deck, newest first. */
export function listCards(deckId: string): Promise<Card[]> {
  return request(`/decks/${deckId}/cards`)
}

export function createCard(
  deckId: string,
  card: { question: string; answer: string; subtopic?: string },
): Promise<Card> {
  return request(`/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify(card) })
}

/** Text only — the server deliberately leaves scheduling alone, so fixing a typo doesn't reset
 * weeks of review history. Sending `subtopic: ''` clears it. */
export function updateCard(
  cardId: string,
  patch: { question?: string; answer?: string; subtopic?: string },
): Promise<Card> {
  return request(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteCard(cardId: string): Promise<void> {
  return request(`/cards/${cardId}`, { method: 'DELETE' })
}

/** Seeds the onboarding starter deck. Not idempotent — calling twice makes two decks. */
export function createSampleDeck(): Promise<Deck> {
  return request('/decks/sample', { method: 'POST' })
}

/** Export runs as a plain navigation, not a fetch: the response carries a Content-Disposition
 * header, so letting the browser handle it gets a real "save file" flow on every platform —
 * including iOS Safari, where a blob URL built in JS often opens the file inline instead of
 * offering to save it.
 */
export function exportUrl(deckId: string | null, format: 'csv' | 'json'): string {
  const path = deckId ? `/api/decks/${deckId}/export` : '/api/decks/export'
  return `${path}?format=${format}`
}
