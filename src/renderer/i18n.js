import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Minimal async loader that uses window.localeAPI.getTranslations
const localeLoader = {
    type: 'backend',
    read: async (language, namespace, callback) => {
        try {
            // First try the preload-provided translations (preferred in Electron)
            if (typeof window !== 'undefined' && window.localeAPI && typeof window.localeAPI.getTranslations === 'function') {
                try {
                    const translations = await window.localeAPI.getTranslations(language);
                    if (translations) return callback(null, translations);
                } catch (e) {
                    // fall through to fetch fallback
                    console.warn('localeLoader: locale API failed', e);
                }
            }

            // fallback to built-in fetch from /locales when served by a web server
            try {
                const res = await fetch(`/locales/${language}.json`);
                if (res.ok) {
                    const json = await res.json();
                    return callback(null, json);
                }
            } catch (e) {
                // ignore
            }

            return callback(new Error('no translations'));
        } catch (err) {
            return callback(err, false);
        }
    }
};

// async init helper: try to read persisted locale from preload, then init i18next
(async function bootstrapI18n() {
    let initialLang = 'en';
    try {
        // prefer persisted locale provided by main/preload
        if (typeof window !== 'undefined' && window.localeAPI && typeof window.localeAPI.getLocale === 'function') {
            const persisted = await window.localeAPI.getLocale();
            if (persisted) initialLang = persisted;
        } else if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) {
            initialLang = document.documentElement.lang;
        }
    } catch (e) {
        // ignore and fall back to defaults
    }

    i18next
        .use(localeLoader)
        .use(initReactI18next);

    try {
        await i18next.init({
            lng: initialLang || 'en',
            fallbackLng: 'en',
            debug: false,
            interpolation: { escapeValue: false },
            react: { useSuspense: false }
        });
        // Mark as initialized so React can render
        i18next.isInitialized = true;
    } catch (e) {
        console.error('i18next init failed', e);
        // Even on failure, mark as initialized to avoid infinite loading
        i18next.isInitialized = true;
    }

    // Subscribe to locale changes broadcast from main process so React updates immediately
    try {
        if (typeof window !== 'undefined' && window.localeAPI && typeof window.localeAPI.onLocaleChanged === 'function') {
            window.localeAPI.onLocaleChanged(async (newLocale) => {
                try {
                    if (!newLocale) return;
                    // changeLanguage will trigger the backend loader to fetch translations
                    await i18next.changeLanguage(newLocale);
                    console.log('i18n: changed language to', newLocale);
                } catch (e) {
                    console.warn('i18n: failed to change language', e);
                }
            });
        }
    } catch (e) {
        // ignore
    }
})();

export default i18next;
