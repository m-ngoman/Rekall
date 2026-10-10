import { AbsoluteFill, Freeze } from 'remotion'
import { Cut, CUTS_BY_ID } from '../cuts/Cut'
import { FPS, SIZES, type Layout } from '../timeline'

export type SheetProps = {
  cut: keyof typeof CUTS_BY_ID
  layout: Layout
  /** Frames to show; every second by default. */
  frames?: number[]
  columns: number
  scale: number
  guides?: boolean
  captions?: boolean
}

export const sheetFrames = (cut: keyof typeof CUTS_BY_ID) =>
  Array.from({ length: Math.ceil(CUTS_BY_ID[cut].durationInFrames / FPS) }, (_, i) => i * FPS)

/** A grid of frames from one cut, each frozen and labelled: the review sheet (npm run contact). */
export const ContactSheet: React.FC<SheetProps> = ({ cut, layout, frames, scale, guides = false, captions = true }) => {
  const list = frames ?? sheetFrames(cut)
  const { width, height } = SIZES[layout]
  const cellW = width * scale
  const cellH = height * scale
  return (
    <AbsoluteFill style={{ background: '#000', padding: 24, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignContent: 'flex-start' }}>
      {list.map((frame) => (
        <div key={frame} style={{ width: cellW }}>
          <div style={{ width: cellW, height: cellH, overflow: 'hidden', position: 'relative' }}>
            <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute' }}>
              <Freeze frame={frame}>
                <Cut cut={cut} layout={layout} silent guides={guides} captions={captions} />
              </Freeze>
            </div>
          </div>
          <div style={{ color: '#aaa', font: '600 22px Nunito', padding: '6px 0' }}>
            {frame} · {(frame / FPS).toFixed(1)} s
          </div>
        </div>
      ))}
    </AbsoluteFill>
  )
}

/** The sheet's size for a number of frames. */
export function sheetSize(layout: Layout, count: number, columns: number, scale: number) {
  const { width, height } = SIZES[layout]
  const rows = Math.ceil(count / columns)
  return { width: Math.round(24 + columns * (width * scale + 24)), height: Math.round(24 + rows * (height * scale + 24 + 36)) }
}
