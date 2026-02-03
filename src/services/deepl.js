const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_BASE_URL = process.env.DEEPL_API_BASE_URL || 'https://api-free.deepl.com/v2';

const SUPPORTED_TARGET_LANGS = new Set([
  'AR',
  'BG',
  'CS',
  'DA',
  'DE',
  'EL',
  'EN',
  'EN-GB',
  'EN-US',
  'ES',
  'ET',
  'FI',
  'FR',
  'HU',
  'ID',
  'IT',
  'JA',
  'KO',
  'LT',
  'LV',
  'NB',
  'NL',
  'PL',
  'PT',
  'PT-BR',
  'PT-PT',
  'RO',
  'RU',
  'SK',
  'SL',
  'SV',
  'TR',
  'UK',
  'ZH',
]);

function ensureKey() {
  if (!DEEPL_API_KEY) {
    const error = new Error('DEEPL_API_KEY is not configured.');
    error.status = 500;
    throw error;
  }
}

function normalizeLanguage(input) {
  if (!input) return null;
  const raw = String(input).replace('_', '-').toUpperCase();
  if (raw.startsWith('EN-')) {
    if (raw === 'EN-US' || raw === 'EN-GB') return raw;
    return 'EN';
  }
  if (raw.startsWith('PT-')) {
    if (raw === 'PT-BR') return 'PT-BR';
    return 'PT-PT';
  }
  const base = raw.split('-')[0];
  return base;
}

function resolveTargetLanguage(input) {
  const normalized = normalizeLanguage(input);
  if (!normalized) return null;
  if (SUPPORTED_TARGET_LANGS.has(normalized)) return normalized;
  if (normalized === 'PT' && SUPPORTED_TARGET_LANGS.has('PT-PT')) return 'PT-PT';
  if (normalized === 'EN' && SUPPORTED_TARGET_LANGS.has('EN-US')) return 'EN-US';
  return null;
}

async function translateTexts({ texts, targetLang, sourceLang }) {
  ensureKey();
  const resolvedTarget = resolveTargetLanguage(targetLang);
  if (!resolvedTarget) {
    const error = new Error('Unsupported target language.');
    error.status = 400;
    throw error;
  }

  const payload = new URLSearchParams();
  payload.append('auth_key', DEEPL_API_KEY);
  payload.append('target_lang', resolvedTarget);
  if (sourceLang) {
    const resolvedSource = resolveTargetLanguage(sourceLang) || normalizeLanguage(sourceLang);
    if (resolvedSource) payload.append('source_lang', resolvedSource);
  }
  texts.forEach((text) => payload.append('text', text));

  const res = await fetch(`${DEEPL_API_BASE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || data?.error?.message || 'DeepL request failed.';
    const error = new Error(message);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  const translations = Array.isArray(data?.translations) ? data.translations : [];
  return {
    targetLang: resolvedTarget,
    translations: translations.map((entry) => entry.text),
  };
}

module.exports = {
  translateTexts,
  resolveTargetLanguage,
};
