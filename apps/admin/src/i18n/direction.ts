import i18n from "i18next"

// Codes flagged `ltr: false` in @mercurjs/admin's built-in language list.
const RTL_LANGUAGES = new Set(["ar", "he", "fa"])

const toBcp47 = (code: string) => code.replace(/([a-z])([A-Z])/g, "$1-$2")

const applyDirection = (language: string) => {
  const base = language.split("-")[0]
  const root = document.documentElement
  root.dir = RTL_LANGUAGES.has(base) ? "rtl" : "ltr"
  root.lang = toBcp47(language)
}

// Registered before the panel initializes i18next, so this also fires for
// the language restored from the "lng" cookie/localStorage on first load.
i18n.on("languageChanged", applyDirection)

if (i18n.language) {
  applyDirection(i18n.language)
}
