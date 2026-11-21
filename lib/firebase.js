import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBsTfanZ4JEcFlQlNVvN2IphgYaKnFA4no",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "myowncloud-fff61.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "myowncloud-fff61",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "myowncloud-fff61.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "70678408455",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:70678408455:web:6adf6efeb918f42dd5e9a2",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-VXRHXR00BF",
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export { app, auth, googleProvider };
