const { initializeApp } = require("firebase/app");
const { getFirestore } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyB6yedH7WPFidqfifEQjKvOss-rzpqv__A",
  authDomain: "quickvillageservice.firebaseapp.com",
  projectId: "quickvillageservice",
  storageBucket: "quickvillageservice.firebasestorage.app",
  messagingSenderId: "453085397164",
  appId: "1:453085397164:web:76c3e89cfdfeb4edbb1f09"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

module.exports = { db };
