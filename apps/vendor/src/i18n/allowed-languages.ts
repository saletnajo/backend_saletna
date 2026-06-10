import i18n from "i18next"

// Must match ALLOWED_LANGUAGE_CODES in vite-plugin-restrict-languages.ts,
// which removes the other languages from the picker at bundle time.
const ALLOWED_LANGUAGES = new Set(["en", "ar"])
const FALLBACK_LANGUAGE = "en"

const enforceAllowedLanguage = (language: string) => {
  if (!ALLOWED_LANGUAGES.has(language.split("-")[0])) {
    void i18n.changeLanguage(FALLBACK_LANGUAGE)
  }
}

// Registered before the panel initializes i18next, so a disallowed language
// restored from the "lng" cookie/localStorage — or saved on a user profile
// before the list was restricted — falls back to English.
i18n.on("languageChanged", enforceAllowedLanguage)

if (i18n.language) {
  enforceAllowedLanguage(i18n.language)
}
