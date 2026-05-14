import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /**
     * i18n + no-native-dialogs guard rails.
     *
     * 1. Block `window.confirm` / `window.alert` / `window.prompt` —
     *    enforces `.cursor/rules/no-native-dialogs.mdc`. The global
     *    dialog API at `components/ui/global-dialogs.tsx` ships with
     *    locale-resolved button labels by default, so callers that
     *    use the proper helper get free i18n.
     *
     * 2. (Deferred) Block bare ASCII JSX literals in `app/(dashboard)/**`
     *    and `components/**`. Enabling `react/jsx-no-literals` codebase-
     *    wide today would flag every existing untranslated surface
     *    (~thousand+ false positives). The plan calls for a phased
     *    rollout — see `.cursor/skills/i18n/SKILL.md`. Until then we
     *    rely on the skill + rule to catch new violations in PR
     *    review. When a surface is fully migrated, add it to a
     *    targeted override block here that opts into
     *    `react/jsx-no-literals` with `noStrings: true`.
     */
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      // `warn` (not `error`) because ~10 legacy call sites still use
      // `window.confirm` and we don't want this rule to break the
      // build before they're migrated. Replace each one with the
      // global dialog API in the same PR that touches the file.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name=/^(confirm|alert|prompt)$/]",
          message:
            "Use confirmDialog / alertDialog / promptDialog from '@/components/ui/global-dialogs' — see .cursor/rules/no-native-dialogs.mdc and .cursor/skills/i18n/SKILL.md.",
        },
      ],
    },
  },
]);

export default eslintConfig;
