import admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID ?? '';
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? '';
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

if (!admin.apps.length) {
  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    admin.initializeApp({
      projectId: projectId || undefined,
    });
  }
}

export const firestore = admin.firestore();
export const firebaseAuth = admin.auth();

export function getFirebaseWebConfig() {
  return {
    apiKey: process.env.FIREBASE_WEB_API_KEY ?? '',
    authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN ?? '',
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    appId: process.env.FIREBASE_WEB_APP_ID ?? '',
    messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID ?? '',
  };
}
