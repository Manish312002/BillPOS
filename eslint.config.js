/**
 * Root ESLint Flat Configuration
 * Pure JavaScript ES Modules & React 19 JSX support
 */

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'apps/api/prisma/**',
      '**/.git/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(React|_)' }],
      'no-console': 'off',
      'no-undef': 'off',
    },
  },
];
