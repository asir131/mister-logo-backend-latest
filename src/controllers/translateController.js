const { validationResult } = require('express-validator');

const { translateTexts } = require('../services/deepl');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

async function translate(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { texts, targetLang, sourceLang } = req.body;
  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'texts must be a non-empty array.' });
  }

  try {
    const result = await translateTexts({
      texts: texts.map((text) => String(text)),
      targetLang,
      sourceLang,
    });
    return res.status(200).json({
      targetLang: result.targetLang,
      translations: result.translations,
    });
  } catch (err) {
    console.error('Translate error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Translation failed.',
    });
  }
}

module.exports = {
  translate,
};
