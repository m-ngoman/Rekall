/** The replicas copy a handful of numbers from the app rather than importing them — they live in
 * components with hooks and effects, which a frame-by-frame render can't run. Each is checked here
 * against the app's source, so a change there fails the video's tests instead of quietly leaving
 * the video showing an app that no longer exists. */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FFT_SIZE } from '../lib/analyser'
import { DIM, FADE_IN_MS, LINK, LINK_WIDTH } from '../lib/loaderFrame'
import { LINE_IN_MS, WORD_LEAD_S, WORD_POP_MS } from '../lib/karaoke'
import { BAND_COUNT, RING_COUNT, SMOOTHING, TICK_COUNT } from '../lib/orb'
import { STRETCH } from '../lib/pill'
import { REVEAL_TICK_MS } from '../lib/reveal'

const app = (file: string) => fs.readFileSync(path.resolve(__dirname, '../../../../frontend/src', file), 'utf8')

describe('numbers copied from the app', () => {
  it('NodeLoader', () => {
    const src = app('components/NodeLoader.tsx')
    expect(src).toContain(`const DIM = ${DIM}`)
    expect(src).toContain(`const LINK = ${LINK}`)
    expect(src).toContain(`const LINK_WIDTH = ${LINK_WIDTH}`)
    expect(app('index.css')).toContain(`animation: node-loader-in ${FADE_IN_MS}ms ease-out`)
  })

  it('VoiceOrb', () => {
    const src = app('components/VoiceOrb.tsx')
    expect(src).toContain(`const BAND_COUNT = ${BAND_COUNT}`)
    expect(src).toContain(`const TICK_COUNT = ${TICK_COUNT}`)
    expect(src).toContain(`const RING_COUNT = ${RING_COUNT}`)
    expect(src).toContain(`const SMOOTHING = ${SMOOTHING}`)
    expect(src).toContain('const baseR = 52 * scale')
    expect(src).toContain('const ringR = baseR - ring * 4.8 * scale')
    expect(src).toContain('bands[idx] * (19 - ring * 1.9) * scale')
    expect(src).toContain('const glowR = baseR + 25 * scale + avg * 41 * scale')
    expect(src).toContain('ctx.globalAlpha = 0.22 + avg * 0.25')
    expect(src).toContain('const coreR = 18 * scale + avg * 16 * scale')
    expect(src).toContain('ctx.globalAlpha = 0.1 + bands[bandIdx] * 0.4')
    expect(src).toContain('Math.floor((i / BAND_COUNT) * data.length * 0.7)')
  })

  it('the analysers feeding it', () => {
    expect(app('hooks/useAudioPlayer.ts')).toContain(`analyser.fftSize = ${FFT_SIZE}`)
    expect(app('hooks/useMicRecorder.ts')).toContain(`analyser.fftSize = ${FFT_SIZE}`)
    for (const f of ['hooks/useAudioPlayer.ts', 'hooks/useMicRecorder.ts']) {
      expect(app(f), `${f} keeps the analyser's default smoothing and range`).not.toMatch(/smoothingTimeConstant|minDecibels|maxDecibels/)
    }
  })

  it('the karaoke', () => {
    expect(app('screens/TutorScreen.tsx')).toContain(`const WORD_LEAD_S = ${WORD_LEAD_S}`)
    const css = app('index.css')
    expect(css).toContain(`animation: focus-word-pop ${WORD_POP_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`)
    expect(css).toContain('0% { color: rgb(255 255 255 / 0.2); transform: translateY(0.12em); }')
    expect(css).toContain('55% { color: #fff; transform: translateY(-0.07em); }')
    expect(css).toContain(`animation: focus-line-in ${LINE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`)
    expect(css).toContain(`animation: focus-line-fade ${LINE_IN_MS}ms ease both`)
    expect(css).toContain('from { opacity: 0; transform: translateY(0.35em); }')
  })

  it('the focus stage', () => {
    const src = app('components/tutor/FocusStage.tsx')
    expect(src).toContain('export const OVERLAY_FADE_MS = 300')
    expect(src).toContain("'radial-gradient(ellipse 95% 60% at 50% 104%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 68%), rgb(13 10 8 / 0.96)'")
    expect(src).toContain("'color-mix(in oklab, var(--accent) 55%, rgb(255 255 255 / 0.45))'")
    expect(src).toContain("'rgb(255 255 255 / 0.42)'")
    expect(src).toContain('size={230}')
    expect(app('screens/TutorScreen.tsx')).toContain('const FLIP_DURATION_MS = 160')
    expect(app('screens/TutorScreen.tsx')).toContain('cubic-bezier(0.16, 1, 0.3, 1)')
  })

  it('the transcript reveal', () => {
    expect(app('hooks/useRevealText.ts')).toContain(`const TICK_MS = ${REVEAL_TICK_MS}`)
  })

  it('the sliding pill', () => {
    const src = app('hooks/useSlidingPill.ts')
    expect(src).toContain(`const STRETCH = ${STRETCH}`)
    expect(src).toContain("const GROW = { ms: '130ms', ease: 'cubic-bezier(0.3, 0.9, 0.4, 1)' }")
    expect(src).toContain("const RELAX = { ms: '520ms', ease: 'cubic-bezier(0.22, 1.12, 0.36, 1)' }")
    expect(src).toContain('const STRETCH_MS = 240')
    const css = app('index.css')
    expect(css).toContain('translate var(--pill-move-ms, 400ms) var(--pill-move-ease, cubic-bezier(0.33, 1.16, 0.45, 1))')
    expect(css).toContain('width var(--pill-move-ms, 400ms) var(--pill-move-ease, cubic-bezier(0.22, 1, 0.36, 1))')
  })

  it('the calendar bars', () => {
    const src = app('components/ExamCalendar.tsx')
    expect(src).toContain('const mix = Math.round((shown / max) * 100)')
    expect(src).toContain('const barHeight = `${Math.max(25, mix)}%`')
    expect(src).toContain('const barColor = `color-mix(in oklab, var(--accent) ${mix}%, var(--accent-dim))`')
  })

  it('the study screen’s words', () => {
    const src = app('screens/StudyScreen.tsx')
    for (const s of ['Check my answer', "'Checking'", 'Type your answer', 'Save for tutor', 'Saved. The tutor will start here next time.', 'Report and remove this card', 'You wrote', 'Model answer', 'Right first time', 'Next card, ${queue.length} left', 'Back in ${days} days']) {
      expect(src, s).toContain(s)
    }
  })
})
