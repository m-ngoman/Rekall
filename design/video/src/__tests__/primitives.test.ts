import { describe, expect, it } from 'vitest'
import { LOGO_NODES, HELD } from '@app/lib/logo'
import { BRIGHT, floatAt } from '@app/lib/loader'
import { wordStarts } from '@app/lib/wordTimings'
import take from '../audio/tutor-sn1-sn2.words.json'
import demo from '../data/demo.json'
import { byteFrequencyData, BIN_COUNT } from '../lib/analyser'
import { cardsBefore, monthCells } from '../lib/calendar'
import { cameraAt } from '../lib/camera'
import { APP_EASE, CSS_EASE, cubicBezier } from '../lib/ease'
import { focusWord, litCount, litFrame } from '../lib/karaoke'
import { assignNodes, logoMorph } from '../lib/logoMorph'
import { orbBandsAt, type OrbInput } from '../lib/orb'
import { pillAt } from '../lib/pill'
import { revealedAt } from '../lib/reveal'
import { streamSchedule, streamedAt } from '../lib/stream'
import { typedAt, typingSchedule } from '../lib/typing'

describe('easing', () => {
  it('matches CSS where CSS publishes values', () => {
    // `ease` at its midpoint, as browsers compute it.
    expect(CSS_EASE(0.5)).toBeCloseTo(0.8024, 3)
    expect(cubicBezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 6)
  })
  it('starts at 0, ends at 1 and never runs backwards', () => {
    let prev = 0
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = APP_EASE(Math.min(1, x))
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
    expect(APP_EASE(0)).toBe(0)
    expect(APP_EASE(1)).toBe(1)
  })
})

describe('typing', () => {
  const text = demo.study.typed
  const schedule = typingSchedule(text, 12, 86, 'study')
  it('types the first key at the start and the last exactly at the end', () => {
    expect(schedule[0]).toBe(12)
    expect(schedule[schedule.length - 1]).toBe(86)
    expect(schedule).toHaveLength(text.length)
  })
  it('only moves forward', () => {
    schedule.forEach((t, i) => i && expect(t).toBeGreaterThanOrEqual(schedule[i - 1]))
  })
  it('has the whole answer typed by the end', () => {
    expect(typedAt(86, text, schedule).text).toBe(text)
    expect(typedAt(11, text, schedule).text).toBe('')
  })
})

describe('streamed explanation', () => {
  const text = demo.study.result.explanation
  const schedule = streamSchedule(text, 122, 180, 'grade')
  it('arrives in whole words and ends complete, on time', () => {
    expect(schedule[schedule.length - 1]).toEqual({ chars: text.length, frame: 180 })
    for (const ev of schedule) expect([' ', undefined]).toContain(text[ev.chars - 1] === ' ' ? ' ' : text[ev.chars] === ' ' || ev.chars === text.length ? undefined : 'mid-word')
  })
  it('shows nothing before the first event', () => {
    expect(streamedAt(121, text, schedule)).toBe('')
  })
})

describe('karaoke', () => {
  const starts = take.words.map((w) => w.s)
  it('lights each word on the frame the app would', () => {
    expect(starts.map((s) => litFrame(s, 420, 30) - 420)).toEqual([0, 12, 34, 43, 73, 87, 99, 111, 123, 131])
  })
  it('agrees with the app’s own count at every frame of the line', () => {
    for (let f = 420; f < 420 + 170; f++) {
      const byFrame = starts.filter((s) => litFrame(s, 420, 30) <= f).length
      expect(litCount((f - 420) / 30, starts), `frame ${f}`).toBe(byFrame)
    }
  })
  it('uses the timings wordStarts would use', () => {
    expect(wordStarts(take.text, take.words).map((w) => w.start)).toEqual(starts)
  })
  it('pops from the idle look to white and settles on its line', () => {
    expect(focusWord(null)).toEqual({ alpha: 0.2, y: 0.12 })
    expect(focusWord(0)).toEqual({ alpha: 0.2, y: 0.12 })
    expect(focusWord(253).alpha).toBeCloseTo(1, 6)
    expect(focusWord(253).y).toBeCloseTo(-0.07, 6)
    expect(focusWord(460)).toEqual({ alpha: 1, y: 0 })
  })
})

describe('the live transcript', () => {
  it('reveals a character every 28 ms', () => {
    expect(revealedAt(27, 'abc')).toBe('')
    expect(revealedAt(28, 'abc')).toBe('a')
    expect(revealedAt(10_000, 'abc')).toBe('abc')
  })
})

describe('the analyser', () => {
  it('reads silence as zero', () => {
    const bytes = byteFrequencyData(new Float32Array(1024), 1024, new Float64Array(BIN_COUNT))
    expect(Math.max(...bytes)).toBe(0)
  })
  it('puts a tone in its bin', () => {
    // Quiet enough to stay under maxDecibels (-30): louder, the neighbouring bins all clip to 255.
    const rate = 48000
    const samples = Float32Array.from({ length: 4096 }, (_, n) => 0.01 * Math.sin((2 * Math.PI * 1000 * n) / rate))
    const smoothed = new Float64Array(BIN_COUNT)
    let bytes: Uint8Array = new Uint8Array(BIN_COUNT)
    for (let k = 0; k < 40; k++) bytes = byteFrequencyData(samples, 1024 + k * 64, smoothed)
    const peak = bytes.indexOf(Math.max(...bytes))
    expect(Math.max(...bytes)).toBeLessThan(255)
    expect(peak).toBe(Math.round((1000 * 256) / rate))
  })
})

describe('the orb', () => {
  const inputAt = (t: number): OrbInput => (t < 1000 ? { state: 'thinking' } : { state: 'speaking', envelope: 1 })
  it('draws a frame the same whatever was drawn before it', () => {
    const a = orbBandsAt(1500, inputAt, null)
    orbBandsAt(900, inputAt, null)
    const b = orbBandsAt(1500, inputAt, null)
    expect([...a]).toEqual([...b])
  })
})

describe('the logo morph', () => {
  it('sends the bright node to the held one', () => {
    expect(assignNodes(floatAt(2600)).toLogo.get(BRIGHT)).toBe(HELD)
  })
  it('lands exactly on the logo', () => {
    const frame = logoMorph(4000, 2600, 1)
    const { toLogo } = assignNodes(floatAt(2600))
    for (const [node, logo] of toLogo) {
      const drawn = frame.nodes.find((n) => n.i === node)!
      expect(drawn.x).toBeCloseTo(LOGO_NODES[logo].x, 9)
      expect(drawn.y).toBeCloseTo(LOGO_NODES[logo].y, 9)
      expect(drawn.r).toBeCloseTo(LOGO_NODES[logo].r, 9)
    }
    expect(frame.edges.every((e) => e.draw === 1)).toBe(true)
    expect(frame.nodes.filter((n) => !toLogo.has(n.i)).every((n) => n.opacity === 0)).toBe(true)
  })
})

describe('the camera', () => {
  const keys = [
    { f: 0, x: 0, y: 0, z: 1 },
    { f: 10, x: 100, y: 50, z: 4 },
  ]
  it('holds outside its keys and hits them exactly', () => {
    expect(cameraAt(-5, keys)).toEqual(keys[0])
    expect(cameraAt(10, keys)).toEqual(keys[1])
    expect(cameraAt(99, keys)).toEqual(keys[1])
  })
  it('zooms evenly in log space', () => {
    expect(cameraAt(5, keys).z).toBeCloseTo(2, 9)
  })
})

describe('the calendar', () => {
  const { cells, max } = monthCells(2026, 9, demo.today, demo.load)
  it('lays October 2026 out Monday first, from 28 September', () => {
    expect(cells[0].iso).toBe('2026-09-28')
    expect(cells).toHaveLength(42)
    expect(cells.find((c) => c.isToday)?.iso).toBe('2026-10-07')
  })
  it('scales bars the way ExamCalendar does', () => {
    const busiest = cells.find((c) => c.count === max)!
    expect(busiest.mix).toBe(100)
    for (const c of cells) expect(c.height).toBe(Math.max(25, Math.round((c.count / max) * 100)))
  })
  it('counts the run-up to the exam from today', () => {
    expect(cardsBefore(demo.load, demo.today, demo.exams[0].date)).toBeGreaterThan(0)
  })
})

describe('the sliding pill', () => {
  it('lands on its target, unstretched', () => {
    const end = pillAt(100, 0, { x: 0, w: 64 }, { x: 128, w: 64 })
    expect(end.x).toBeCloseTo(128, 9)
    expect(end.scaleX).toBeCloseTo(1, 9)
  })
})
