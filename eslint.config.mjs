import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "convex/_generated/**", ".max-data/**", "node_modules/**", "next-env.d.ts", "coverage/**", "test-results/**"] },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      // Deliberate patterns: syncing local drafts from props, autosave refs, recursive retry timers.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];

export default config;
