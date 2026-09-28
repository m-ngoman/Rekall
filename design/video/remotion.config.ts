// Everything the Remotion CLI needs, in the one place both `remotion studio` and the render
// scripts read. The scripts shell out to the CLI rather than calling @remotion/renderer, so a
// setting changed here can't silently apply to one path and not the other.
import fs from 'node:fs'
import path from 'node:path'
import { Config } from '@remotion/cli/config'

// The container this was built in has Playwright's headless shell pre-installed and no network
// route to Remotion's own browser download. Anywhere else, null lets Remotion fetch its own.
const PW_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? (fs.existsSync(PW_SHELL) ? PW_SHELL : null))
Config.setChromeMode('headless-shell')
Config.setChromiumOpenGlRenderer('swangle')

Config.setEntryPoint('src/index.ts')
Config.setVideoImageFormat('png')
Config.setCodec('h264')
Config.setCrf(16)
Config.setX264Preset('slow')
Config.setPixelFormat('yuv420p')
Config.setColorSpace('bt709')
Config.setAudioCodec('aac')
Config.setAudioBitrate('320k')
Config.setSampleRate(48000)
Config.setConcurrency(3)
Config.setDelayRenderTimeoutInMilliseconds(60_000)
Config.setOverwriteOutput(true)

const root = process.cwd()

// Two changes to Remotion's webpack setup, both so the app's own code and CSS arrive unaltered:
//  - `@app` resolves to the frontend's sources, so the video imports the app's pure modules
//    (loader, logo, word timings, icons) instead of keeping copies of them.
//  - CSS goes through exactly the app's PostCSS pipeline (frontend/postcss.config.js: Tailwind
//    and autoprefixer, nothing else). @remotion/tailwind is deliberately not used: it runs
//    postcss-preset-env first, which would rewrite the app's oklch(), relative colours and
//    color-mix() — the very tokens the replicas exist to reproduce.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias as Record<string, string> | undefined),
      '@app': path.resolve(root, '../../frontend/src'),
    },
  },
  module: {
    ...config.module,
    rules: [
      ...(config.module?.rules ?? []).filter(
        (rule) => !(rule && rule !== '...' && typeof rule === 'object' && String(rule.test).includes('.css')),
      ),
      {
        test: /\.css$/i,
        use: [
          require.resolve('style-loader'),
          { loader: require.resolve('css-loader'), options: { importLoaders: 1 } },
          {
            loader: require.resolve('postcss-loader'),
            options: {
              postcssOptions: {
                config: false,
                plugins: [
                  require('tailwindcss')({ config: path.resolve(root, 'tailwind.config.mjs') }),
                  require('autoprefixer'),
                ],
              },
            },
          },
        ],
        type: 'javascript/auto',
      },
    ],
  },
}))
