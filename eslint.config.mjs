import parser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * One rule, deliberately.
 *
 * This is not a style config and is not trying to become one. It exists because
 * of a specific bug: a useQuery was added below an early return, so deleting an
 * event made the screen render one hook fewer than the render before it and
 * React refused to continue. Nothing about that is visible in review, it
 * typechecks, and it only appears when the data underneath disappears, which is
 * the one moment nobody is testing.
 *
 * rules-of-hooks catches exactly that, precisely, where a hand-rolled scan of
 * the source cannot: it understands function boundaries, conditionals and
 * loops. The rest of ESLint's opinions are somebody else's argument and are
 * left off, so this stays a correctness check rather than a taste check.
 */
export default [
  {
    files: ["src/apps/mobile/**/*.{ts,tsx}"],
    ignores: ["**/node_modules/**", "**/dist/**"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
