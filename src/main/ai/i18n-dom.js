// Minimal DOM-centric i18n helper for static pages (chatPage.html)
// Usage: i18nDom.init().then(() => { /* translations applied */ })
(function (global) {
    const i18nDom = {
        async loadTranslations(locale) {
            if (global.localeAPI && typeof global.localeAPI.getTranslations === 'function') {
                try {
                    const t = await global.localeAPI.getTranslations(locale);
                    if (t) return t;
                } catch (e) { }
            }
            try {
                const res = await fetch(`/locales/${locale}.json`);
                if (res.ok) return await res.json();
            } catch (e) { }
            return null;
        },

        // simple interpolation: replace {{key}} in str with values[key]
        interpolate(str, values) {
            if (!str || !values) return str;
            return String(str).replace(/{{\s*([^\s}]+)\s*}}/g, (_, k) => (k in values ? values[k] : ''));
        },

        applyTranslations(trans) {
            if (!trans || typeof trans !== 'object') return;
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                const parts = key.split('.');
                let cur = trans;
                for (const p of parts) {
                    if (cur && typeof cur === 'object' && p in cur) cur = cur[p]; else { cur = null; break; }
                }
                if (cur != null) el.textContent = cur;
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                const parts = key.split('.');
                let cur = trans;
                for (const p of parts) {
                    if (cur && typeof cur === 'object' && p in cur) cur = cur[p]; else { cur = null; break; }
                }
                if (cur != null) el.setAttribute('placeholder', cur);
            });
        },

        async init(defaultLocale = 'en') {
            try {
                if (global.localeAPI && typeof global.localeAPI.getLocale === 'function') {
                    const locale = await global.localeAPI.getLocale();
                    let t = null;
                    try { t = await this.loadTranslations(locale); } catch (e) { t = null; }
                    if (!t) t = await this.loadTranslations(defaultLocale);
                    if (t) this.applyTranslations(t);

                    if (global.localeAPI && typeof global.localeAPI.onLocaleChanged === 'function') {
                        global.localeAPI.onLocaleChanged(async (newLocale) => {
                            let tt = null;
                            try { tt = await this.loadTranslations(newLocale); } catch (e) { tt = null; }
                            if (!tt) tt = await this.loadTranslations(defaultLocale);
                            if (tt) this.applyTranslations(tt);
                        });
                    }
                    return;
                }
                // Fallback: try default locale
                const t = await this.loadTranslations(defaultLocale);
                if (t) this.applyTranslations(t);
            } catch (e) { /* ignore */ }
        }
    };

    // expose
    if (!global.i18nDom) global.i18nDom = i18nDom;
    // For module consumers
    if (typeof module !== 'undefined' && module.exports) module.exports = i18nDom;
})(typeof window !== 'undefined' ? window : this);
