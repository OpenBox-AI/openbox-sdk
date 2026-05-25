import tseslint from 'typescript-eslint';

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-pack/**',
      'coverage/**',
      'specs/generated/**',
      'ts/src/**/generated/**',
      'codegen/**/dist/**',
      'apps/**/dist/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['ts/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',
    },
  },
];
