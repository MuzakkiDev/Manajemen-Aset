// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

// Ganti konfigurasi di bawah ini dengan milik project Firebase Anda
// (Didapatkan dari Firebase Console > Project Settings > General > Your apps)
const firebaseConfig = {
  apiKey: "AIzaSyB7IxvdWKPabnjqXKtGQ2sujOi-UOgY4hk",
  authDomain: "manajemen-aset-103f2.firebaseapp.com",
  projectId: "manajemen-aset-103f2",
  storageBucket: "manajemen-aset-103f2.firebasestorage.app",
  messagingSenderId: "1092818439520",
  appId: "1:1092818439520:web:9897d1905606fb44586205"
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
