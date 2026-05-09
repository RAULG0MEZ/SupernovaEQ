// Configuración de ESLint (revisa el código y avisa de errores comunes:
// imports sin usar, variables huérfanas, hooks mal usados, etc.).
//
// Uso:
//   npm run lint          → revisa todo
//   npm run lint:fix      → arregla lo que pueda automáticamente

import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      react,
      "react-hooks": reactHooks
    },
    settings: {
      react: { version: "detect" }
    },
    rules: {
      // Errores comunes que evitamos
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",

      // React
      "react/jsx-uses-react": "off", // React 17+ no necesita import explícito
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off", // No usamos PropTypes en este proyecto
      "react/jsx-uses-vars": "error",

      // Hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    ignores: ["dist/", "node_modules/", "plugin-shell/"]
  }
];
