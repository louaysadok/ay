/**
 * Localization.js — file-based string table with runtime fallback.
 *
 * English is the source language; French and Arabic are shipped as separate
 * tables (See src/data/strings.*.json). Missing keys fall back to English so a
 * partially translated language never shows raw key names to the player.
 * Arabic switches the document to RTL; the CSS mirrors the layout.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr', flag: 'EN' },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr', flag: 'FR' },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl', flag: 'AR' }
];

export class Localization {
  constructor(bus) {
    this.bus = bus;
    this.lang = 'en';
    this.tables = {};
    this.fallback = {};
  }

  async load(basePath = 'src/data') {
    const load = async (code) => {
      const res = await fetch(`${basePath}/strings.${code}.json`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`missing language file: ${code}`);
      return res.json();
    };
    this.fallback = await load('en');
    this.tables.en = this.fallback;
    for (const l of LANGUAGES) {
      if (l.code === 'en') continue;
      try { this.tables[l.code] = await load(l.code); }
      catch (e) { console.warn('[i18n]', e.message); this.tables[l.code] = {}; }
    }
    return this;
  }

  setLanguage(code) {
    if (!this.tables[code]) code = 'en';
    this.lang = code;
    const meta = LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
    document.documentElement.lang = code;
    document.documentElement.dir = meta.dir;
    document.body.classList.toggle('rtl', meta.dir === 'rtl');
    this.applyToDOM();
    this.bus?.emit('i18n:changed', { lang: code, dir: meta.dir });
  }
  get isRTL() { return (LANGUAGES.find((l) => l.code === this.lang)?.dir) === 'rtl'; }

  /** Translate with {placeholder} interpolation. */
  t(key, vars = {}) {
    const table = this.tables[this.lang] || {};
    let s = table[key] ?? this.fallback[key] ?? key;
    if (vars && typeof s === 'string') {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    }
    return s;
  }

  /** Apply data-i18n attributes across the document. */
  applyToDOM(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) el.setAttribute(attr, this.t(key));
      else el.textContent = this.t(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', this.t(el.getAttribute('data-i18n-title')));
    });
  }

  /** Number formatting that respects the active language. */
  num(n, digits = 0) {
    const locale = this.lang === 'fr' ? 'fr-FR' : this.lang === 'ar' ? 'ar-EG' : 'en-GB';
    try { return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n); }
    catch { return Number(n).toFixed(digits); }
  }
  /** Decimal separator differs between locales; write it out explicitly. */
  dec(n, digits = 1) {
    const s = Number(n).toFixed(digits);
    return this.lang === 'fr' ? s.replace('.', ',') : s;
  }
  list(items) {
    if (!items?.length) return '';
    if (items.length === 1) return items[0];
    const and = this.t('common.and');
    return this.lang === 'ar'
      ? items.join(' و ')
      : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
  }
}

export default Localization;
