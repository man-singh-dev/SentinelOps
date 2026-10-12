import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Global ignores — these files/dirs are excluded from linting entirely.
    ignores: [
      "node_modules/",
      "dist/",
      "scripts/",
      "eslint.config.mjs",
      "vitest.config.mjs",
      "coverage/",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // drizzle.config.ts lives outside src/ (tsconfig rootDir), so lint it via a default project.
          allowDefaultProject: ["drizzle.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);

//Rulebook for your code quality checker
