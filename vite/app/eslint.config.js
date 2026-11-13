import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // jsx-uses-vars is the ONE rule taken from
      // eslint-plugin-react: it marks a component as used
      // when it appears in JSX, so an unused component
      // import is a real error instead of being hidden by
      // an ignore-everything-capitalised pattern
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          // Deliberate non-component exports living beside
          // components: the navbar's catalog table + hooks
          // (FAUCET_TYPES, useFaucetCatalogs, faucetTargetFor)
          // and WalletFlow's useAlerts — shared with App.jsx
          // and the faucet pages by design
          allowExportNames: ['FAUCET_TYPES', 'useFaucetCatalogs', 'faucetTargetFor', 'useAlerts'],
        },
      ],
    },
  },
  // Test files run in node (vitest) — process, __dirname and
  // co are real there — and fast refresh never loads a test
  // file, so its support modules may export helpers next to
  // components
  {
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // The MetaMask browser suite is node code that drives a real
  // browser (Playwright, not vitest), and some of its
  // functions are handed to the page to run there — both sets
  // of globals are real. Its .mjs files match no block above
  // and would otherwise be read without a single rule
  {
    files: ['tests-metamask/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },
]
