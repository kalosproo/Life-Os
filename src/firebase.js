import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBPr2ugw0Tn2LjYWA5U3gGQUoJHttdOyPM',
  authDomain: 'life-os-55.firebaseapp.com',
  projectId: 'life-os-55',
  storageBucket: 'life-os-55.firebasestorage.app',
  messagingSenderId: '318820671560',
  appId: '1:318820671560:web:05514f7c46a619e187787d',
  measurementId: 'G-PMBTQSWKHD',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

export const analyticsPromise = isSupported()
  .then((supported) => (supported ? getAnalytics(app) : null))
  .catch(() => null);
