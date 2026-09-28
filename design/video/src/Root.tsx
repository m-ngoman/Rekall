import '@app/index.css'
import './fonts'
import { Composition, Folder, Still } from 'remotion'
import { Cut, CUTS_BY_ID, type CutProps } from './cuts/Cut'
import { applyTheme } from './theme'
import { FIDELITY_STATES, Fidelity, fidelitySize } from './tools/Fidelity'
import { ContactSheet, sheetFrames, sheetSize, type SheetProps } from './tools/ContactSheet'
import { Smoke } from './tools/Smoke'
import { FPS, SIZES, type Layout } from './timeline'

applyTheme()

const LAYOUTS: Layout[] = ['landscape', 'portrait']

export const Root: React.FC = () => {
  return (
    <>
      {Object.values(CUTS_BY_ID).flatMap((cut) =>
        LAYOUTS.map((layout) => (
          <Composition
            key={`${cut.id}-${layout}`}
            id={`${cut.id}-${layout === 'landscape' ? 'Landscape' : 'Portrait'}`}
            component={Cut}
            durationInFrames={cut.durationInFrames}
            fps={FPS}
            {...SIZES[layout]}
            defaultProps={{ cut: cut.id, layout, silent: false, music: true, guides: false, captions: true } satisfies CutProps}
          />
        )),
      )}
      <Still id="Smoke" component={Smoke} width={1200} height={400} />
      <Folder name="Sheets">
        {Object.values(CUTS_BY_ID).flatMap((cut) =>
          LAYOUTS.map((layout) => {
            const columns = layout === 'landscape' ? 6 : 10
            const scale = layout === 'landscape' ? 1 / 3 : 1 / 4
            const count = sheetFrames(cut.id).length
            return (
              // As long as the cut, though only frame 0 is ever rendered: each cell freezes the cut at
              // its own frame, and a Sequence is clipped to the length of the composition it is in.
              <Composition
                key={`sheet-${cut.id}-${layout}`}
                id={`Sheet-${cut.id}-${layout === 'landscape' ? 'Landscape' : 'Portrait'}`}
                component={ContactSheet}
                durationInFrames={cut.durationInFrames}
                fps={FPS}
                {...sheetSize(layout, count, columns, scale)}
                defaultProps={{ cut: cut.id, layout, columns, scale } satisfies SheetProps}
                calculateMetadata={({ props }) => ({ ...sheetSize(props.layout, props.frames?.length ?? count, props.columns, props.scale) })}
              />
            )
          }),
        )}
      </Folder>
      <Folder name="Fidelity">
        {Object.keys(FIDELITY_STATES).flatMap((state) =>
          LAYOUTS.map((layout) => (
            <Still
              key={`${state}-${layout}`}
              id={`Fidelity-${state}-${layout}`}
              component={Fidelity}
              {...fidelitySize(layout)}
              defaultProps={{ state, layout }}
            />
          )),
        )}
      </Folder>
    </>
  )
}
