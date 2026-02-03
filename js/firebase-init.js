// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyATAwIspPgwd35B_OoNuCoS1pq0riARunI",
  authDomain: "behavior-tracker-77566.firebaseapp.com",
  databaseURL: "https://behavior-tracker-77566-default-rtdb.firebaseio.com",
  projectId: "behavior-tracker-77566",
  storageBucket: "behavior-tracker-77566.firebasestorage.app",
  messagingSenderId: "47570784330",
  appId: "1:47570784330:web:10a5b4e4e0a0e8553ad6b3"
};
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const provider = new GoogleAuthProvider();

export const fb = {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
};

export const authFns = {
  signInWithPopup,
  onAuthStateChanged,
  signOut
};
