import { describe, expect, it } from 'vitest'
import { kindLabel, previewText } from './notes'

describe('kindLabel', () => {
  it('names each kind of note', () => {
    expect(kindLabel('pdf')).toBe('PDF')
    expect(kindLabel('image')).toBe('Photo')
    expect(kindLabel('text')).toBe('Note')
  })
})

describe('previewText', () => {
  it('is the preview when there is one', () => {
    expect(previewText({ file_type: 'pdf', preview: 'Chapter 3' })).toBe('Chapter 3')
  })

  it('says why there is none', () => {
    expect(previewText({ file_type: 'text', preview: '' })).toBe('Nothing written yet.')
    expect(previewText({ file_type: 'pdf', preview: '' })).toBe('No text was read from this file.')
    expect(previewText({ file_type: 'image', preview: '' })).toBe('No text was read from this file.')
  })
})
