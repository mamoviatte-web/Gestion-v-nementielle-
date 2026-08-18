import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Config plate ESLint 9 pour Vite + React + TypeScript.
// On lint le code applicatif (src/) ; le reste (build, scripts CI, migrations)
// est ignoré. TypeScript strict couvre déjà les types ; ESLint ajoute les
// règles React Hooks + hygiène JS.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'supabase', 'scripts', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // tsc (noUnusedLocals) gère déjà les inutilisés ; on autorise le préfixe _.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Autorise les expressions à effet de bord idiomatiques :
      // `cond && fn()` et `cond ? a() : b()` (ex. toggle d'un Set).
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
);
