const fs = require('fs');
const path = require('path');

let adminModule = null;
let adminApp = null;
let messagingInstance = null;
let authInstance = null;

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

function getFirebaseAdminModule() {
  if (adminModule) return adminModule;
  try {
    // Lazy require keeps server bootable if firebase-admin is not installed yet.
    // eslint-disable-next-line global-require
    adminModule = require('firebase-admin');
  } catch (err) {
    throw new Error('firebase-admin dependency missing. Run: npm i firebase-admin');
  }
  return adminModule;
}

function getFirebaseAdminApp() {
  if (adminApp) return adminApp;

  const admin = getFirebaseAdminModule();
  if (admin.apps.length === 0) {
    const serviceAccount = readServiceAccountFromEnv();
    if (serviceAccount) {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      adminApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } else {
      throw new Error(
        'Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT_PATH, or GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }
  } else {
    adminApp = admin.app();
  }

  return adminApp;
}

function getFirebaseMessaging() {
  if (messagingInstance) return messagingInstance;

  const admin = getFirebaseAdminModule();
  const app = getFirebaseAdminApp();
  messagingInstance = admin.messaging(app);
  return messagingInstance;
}

function getFirebaseAuth() {
  if (authInstance) return authInstance;

  const admin = getFirebaseAdminModule();
  const app = getFirebaseAdminApp();
  authInstance = admin.auth(app);
  return authInstance;
}

module.exports = {
  getFirebaseAdminApp,
  getFirebaseMessaging,
  getFirebaseAuth,
};
