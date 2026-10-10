import { createContext, useContext } from 'react'
import { useCurrentFrame } from 'remotion'
import anchors from '../data/anchors.json'
import { FPS, type Layout } from '../timeline'

/** How far into its Sequence a scene's own frame 0 is. A scene that crossfades in starts playing
 * a few frames before its first beat; its beats stay numbered from the frame it is fully in, and
 * the frames before that are negative. A Sequence can't count below zero, so scenes read this. */
export const SceneOffset = createContext(0)
export const useSceneFrame = () => useCurrentFrame() - useContext(SceneOffset)

/** Frames to milliseconds, for the app's own timings. */
export const ms = (frames: number) => (frames / FPS) * 1000

type Box = { x: number; y: number; w: number; h: number }
const A = anchors as unknown as Record<Layout, Record<string, Record<string, Box | number>>>

/** The middle of a control as the real app lays it out (src/data/anchors.json, measured by
 * scripts/reference.mjs --anchors), in the replica's CSS pixels, plus any scroll to take off. */
export function centre(layout: Layout, state: string, name: string, scrollY = 0): { x: number; y: number } {
  const b = A[layout][state]?.[name] as Box | undefined
  if (!b) throw new Error(`No anchor ${name} in ${state} (${layout}); run npm run reference -- --anchors`)
  const measured = (A[layout][state].scrollY as number) ?? 0
  return { x: b.x + b.w / 2, y: b.y + measured - scrollY + b.h / 2 }
}

export const box = (layout: Layout, state: string, name: string) => A[layout][state][name] as Box
