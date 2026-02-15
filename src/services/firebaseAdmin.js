const fs = require('fs');
const path = require('path');

let messagingInstance = null;

function readServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON.');
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const decoded = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
        'base64',
      ).toString('utf8');
      return JSON.parse(decoded);
    } catch (err) {
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_BASE64.');
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const rawPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH.trim();
    const resolvedPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_PATH not found: ${resolvedPath}`,
      );
    }

    try {
      return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    } catch (err) {
      throw new Error('Invalid JSON in FIREBASE_SERVICE_ACCOUNT_PATH file.');
    }
  }

  return null;
}

function getFirebaseMessaging() {
  if (messagingInstance) return messagingInstance;

  let admin;
  try {
    // Lazy require keeps server bootable if firebase-admin is not installed yet.
    // eslint-disable-next-line global-require
    admin = require('firebase-admin');
  } catch (err) {
    throw new Error(
      'firebase-admin dependency missing. Run: npm i firebase-admin',
    );
  }

  if (admin.apps.length === 0) {
    const serviceAccount = readServiceAccountFromEnv();
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } else {
      throw new Error(
        'Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT_PATH, or GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }
  }

  messagingInstance = admin.messaging();
  return messagingInstance;
}

module.exports = {
  getFirebaseMessaging,
};
