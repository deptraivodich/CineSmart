export default [
  { ignores: ['dist/**', '.build-anime-validation/**', 'node_modules/**', 'vite.config.js.timestamp-*'] },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'api/**/*.js', 'server/**/*.js', 'src/utils/chatContext.js', 'src/utils/cloudMovieSync.js', 'src/utils/movieImport.js', 'src/utils/MagicParser.js', 'src/utils/textUtils.js', 'src/services/phimApiImport.js', 'src/components/admin/MagicImport.jsx'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: Object.fromEntries(['console', 'process', 'Buffer', 'URL', 'TextEncoder', 'AbortSignal', 'fetch', 'setTimeout', 'clearTimeout', 'structuredClone', 'window', 'localStorage', 'CustomEvent'].map(k => [k, 'readonly'])),
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/components/admin/MagicImport.jsx'],
    rules: { 'no-unused-vars': 'off' },
  },
];
