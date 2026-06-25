// ============================================================
//  Firebase cloud-sync configuration
// ============================================================
// Cloud sync is OPTIONAL. Until you fill this in, the app works exactly as
// before — fully on-device. To turn on multi-device sync & shared accounts:
//
//   1. Create a free Firebase project (see README → "Cloud sync setup").
//   2. Paste your Web app config below (Project settings → Your apps → Web).
//      These values are NOT secrets — they only identify your project.
//   3. Set CLOUD_ENABLED to true.
//
// That's it. Sign in from Settings → Account & sync on each device.

export const CLOUD_ENABLED = false;

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
