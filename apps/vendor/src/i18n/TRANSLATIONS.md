# Editing translations (vendor panel)

This folder is the single place to change wording in the vendor panel.

## How it works

The full UI translations — including the complete Arabic catalog — ship inside
the `@mercurjs/vendor` package. At build time the dashboard plugin exposes this
folder's `index.ts` as `virtual:mercur/i18n`, and the panel deep-merges it over
its built-in resources. **Any key you define here wins over the built-in
value**; keys you don't define keep the package translation.

- `en.json` — English strings for this app's custom pages, plus any overrides
  of built-in English wording. Structural source of truth for custom keys.
- `ar.json` — Arabic counterparts. Same key structure as `en.json`.
- `direction.ts` — applies `dir="rtl"` / `dir="ltr"` and `lang` to `<html>`
  whenever the active language changes (imported from `src/main.tsx`).

## Correcting an Arabic string

1. Find the key. For built-in panel strings, search the English text in
   `node_modules/@mercurjs/vendor/dist/` (the `ar`/`en` catalogs are bundled
   there) or in the upstream source:
   https://github.com/mercurjs/mercur/tree/main/packages/vendor/src/i18n/translations
2. Add the key with the corrected Arabic value to `ar.json` here, keeping the
   exact same nested key path. Do not edit `node_modules` — it is overwritten
   on install.
3. Preserve i18next tokens: `{{count}}`, `{{name}}`, and `_one`/`_other`
   plural suffixes.
4. Never delete keys to "remove" a translation — a missing key simply falls
   back to English automatically.

## Adding a new language or flipping direction

The language picker list (codes, display names, `ltr` flags) is defined inside
`@mercurjs/vendor` and is not extensible from this app. If a new language must
be added there, it is an upstream change. RTL languages currently flagged
upstream are `ar`, `he`, `fa` — keep `RTL_LANGUAGES` in `direction.ts` in sync
if that list ever changes.
