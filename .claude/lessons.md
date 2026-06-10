# Lessons Learned

### App workspace builds must run through turbo
Running `yarn build` directly inside `apps/admin` or `apps/vendor` fails with
`command not found: tsc` — `typescript`/`vite` are root devDependencies and
yarn 4 only exposes a workspace's own binaries. Run builds from the repo root
instead: `yarn turbo run build --filter=@acme/vendor` (turbo prepends the root
`node_modules/.bin` to PATH).

### Route type codegen writes `.mercur/index.d.ts`, not `_generated`
`@mercurjs/cli@2.1.6` codegen (run from `packages/api` via
`node node_modules/@mercurjs/cli/dist/index.js codegen`) writes
`.mercur/index.d.ts`. The starter originally pointed the `@acme/api/_generated`
export at `.mercur/_generated/index.ts`, which nothing generates, breaking
`tsc` in both apps. The export map now targets `.mercur/index.d.ts`; keep it
that way after CLI upgrades unless the CLI's output path changes.

### Panel i18n internals live in the prebuilt @mercurjs packages
`languages.ts` (codes, display names, `ltr` flags), the full translation
catalogs (Arabic included), and the i18next init all ship inside
`@mercurjs/vendor` / `@mercurjs/admin` dist bundles — they are not editable in
this repo. Customize translations by adding keys under `apps/*/src/i18n/`
(exposed as `virtual:mercur/i18n` and deep-merged over the built-ins, app keys
win). App code can hook the panel's i18next instance directly with
`import i18n from "i18next"` because `mercurDashboardPlugin` dedupes i18next —
that is how `apps/*/src/i18n/direction.ts` syncs `dir`/`lang` on `<html>`.
RTL is driven entirely by the `dir` attribute; `@medusajs/ui` watches it with
a MutationObserver.
