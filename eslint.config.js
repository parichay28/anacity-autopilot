import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/*
 * Flat config. typescript-eslint's `recommended` (not the type-checked variant)
 * keeps linting fast and needs no program build — tsc already owns type safety
 * via `npm run typecheck`, so ESLint's job here is the lint-only rules tsc does
 * not cover. `prettier` last disables every formatting rule so Prettier owns
 * layout with no conflicts.
 */
export default tseslint.config(
  { ignores: ["node_modules/**", "planning/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      /* The ANACITY wire layer needs the empty-object cleared-cookie and a few
       * intentional throwaways; underscore-prefixed names opt out. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
