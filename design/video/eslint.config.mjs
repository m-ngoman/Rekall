// The app's lint set (frontend/eslint.config.js), plus Remotion's rules. `non-pure-animation` is an
// error here, not the plugin's warning: a CSS transition or animation in a composition renders
// differently on every frame and every machine, and the whole point of the replicas is that they
// don't.
import js from '@eslint/js'
import remotion from '@remotion/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out', 'public', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...remotion.flatPlugin,
    rules: {
      ...remotion.flatPlugin.rules,
      '@remotion/non-pure-animation': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{mjs,mts,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['remotion.config.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
