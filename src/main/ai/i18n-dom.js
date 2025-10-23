// Minimal DOM-centric i18n helper for static pages (chatPage.html)
// Usage: i18nDom.init().then(() => { /* translations applied */ })
(function (global) {
    const i18nDom = {
        _activeTranslations: null,
        _fallbackTranslations: null,
        _currentLocale: null,

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

        resolveKey(bundle, keyPath) {
            if (!bundle || !keyPath) return null;
            const parts = String(keyPath).split('.');
            let cur = bundle;
            for (const p of parts) {
                if (cur && typeof cur === 'object' && p in cur) {
                    cur = cur[p];
                } else {
                    return null;
                }
            }
            return cur;
        },

        t(key, values) {
            const primary = this.resolveKey(this._activeTranslations, key);
            const fallback = primary == null ? this.resolveKey(this._fallbackTranslations, key) : primary;
            if (fallback == null) return null;
            return this.interpolate(fallback, values);
        },

        applyTranslations(trans) {
            if (!trans || typeof trans !== 'object') return;
            this._activeTranslations = trans;

            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                const value = this.t(key);
                if (value != null) el.textContent = value;
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                const value = this.t(key);
                if (value != null) el.setAttribute('placeholder', value);
            });

            document.querySelectorAll('[data-i18n-title]').forEach(el => {
                const key = el.getAttribute('data-i18n-title');
                const value = this.t(key);
                if (value != null) el.setAttribute('title', value);
            });
        },

        async init(defaultLocale = 'en') {
            try {
                if (!this._fallbackTranslations) {
                    try { this._fallbackTranslations = await this.loadTranslations(defaultLocale); } catch (e) { this._fallbackTranslations = null; }
                }

                let targetLocale = defaultLocale;
                if (global.localeAPI && typeof global.localeAPI.getLocale === 'function') {
                    const detected = await global.localeAPI.getLocale();
                    if (detected) targetLocale = detected;
                }

                let bundle = null;
                if (targetLocale) {
                    try { bundle = await this.loadTranslations(targetLocale); } catch (e) { bundle = null; }
                }
                if (!bundle && this._fallbackTranslations) {
                    bundle = this._fallbackTranslations;
                    targetLocale = defaultLocale;
                }

                if (bundle) {
                    this._currentLocale = targetLocale;
                    this.applyTranslations(bundle);
                }

                if (global.localeAPI && typeof global.localeAPI.onLocaleChanged === 'function') {
                    global.localeAPI.onLocaleChanged(async (newLocale) => {
                        let nextBundle = null;
                        try { nextBundle = await this.loadTranslations(newLocale); } catch (e) { nextBundle = null; }
                        if (!nextBundle && this._fallbackTranslations) {
                            nextBundle = this._fallbackTranslations;
                            newLocale = defaultLocale;
                        }
                        if (nextBundle) {
                            this._currentLocale = newLocale;
                            this.applyTranslations(nextBundle);
                        }
                    });
                } else if (!bundle && this._fallbackTranslations) {
                    this._currentLocale = defaultLocale;
                    this.applyTranslations(this._fallbackTranslations);
                }
            } catch (e) { /* ignore */ }
        }
    };

    // expose
    if (!global.i18nDom) global.i18nDom = i18nDom;
    // For module consumers
    if (typeof module !== 'undefined' && module.exports) module.exports = i18nDom;
})(typeof window !== 'undefined' ? window : this);
