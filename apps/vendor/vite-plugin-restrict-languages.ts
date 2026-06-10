import fs from "node:fs"
import type { Plugin } from "vite"

// Codes kept in the panel language picker. Must match ALLOWED_LANGUAGES in
// src/i18n/allowed-languages.ts, which enforces the same list at runtime.
const ALLOWED_LANGUAGE_CODES = ["en", "ar"]

const PANEL_DIST_FILE = /@mercurjs[\\/](admin|vendor)[\\/]dist[\\/][^\\/]+\.js$/

/**
 * The full 30+ entry language list ships inside the prebuilt @mercurjs panel
 * bundle (its `src/i18n/languages.ts` module) and the dashboard SDK exposes
 * no option to narrow it, so the array is filtered at bundle time instead.
 * The module is identified by content, not file name, because the dist chunk
 * names are content-hashed and change on every package upgrade.
 */
const filterLanguagesModule = (code: string): string | null => {
  if (!code.includes("var languages = [") || !code.includes("display_name")) {
    return null
  }
  return code.replace(
    /export\s*\{\s*languages\s*\}/,
    (exportStatement) =>
      `languages = languages.filter((language) => ${JSON.stringify(
        ALLOWED_LANGUAGE_CODES
      )}.includes(language.code));\n${exportStatement}`
  )
}

/**
 * Vite dev pre-bundles the panel package with esbuild, where Rollup
 * `transform` hooks never run — the filter has to be registered twice:
 * once for `vite build` (transform) and once for dev (esbuild onLoad).
 */
export function restrictPanelLanguages(): Plugin {
  return {
    name: "restrict-panel-languages",
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "restrict-panel-languages",
                setup(build) {
                  build.onLoad({ filter: PANEL_DIST_FILE }, (args) => {
                    const code = fs.readFileSync(args.path, "utf8")
                    const filtered = filterLanguagesModule(code)
                    return filtered
                      ? { contents: filtered, loader: "js" as const }
                      : undefined
                  })
                },
              },
            ],
          },
        },
      }
    },
    transform(code, id) {
      if (!PANEL_DIST_FILE.test(id)) {
        return null
      }
      const filtered = filterLanguagesModule(code)
      return filtered ? { code: filtered, map: null } : null
    },
  }
}
