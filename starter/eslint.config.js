/**
 * ESLint flat config used by the ESLint MCP server when linting PR files
 * Core rules only, so no plugins need to be installed
 */
export default [
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': 'warn',
      'no-undef': 'off',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-cond-assign': 'error',
      'no-fallthrough': 'warn',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'warn',
      'no-prototype-builtins': 'warn',
      'no-throw-literal': 'error',
      'complexity': ['warn', 15],
      'max-depth': ['warn', 4]
    }
  }
];
