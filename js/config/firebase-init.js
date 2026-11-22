import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCSRfZdAVh8ADPNtayW5lyDtmE0xDsJXNg",
  authDomain: "gen-lang-client-0208380044.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0208380044-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0208380044",
  storageBucket: "gen-lang-client-0208380044.firebasestorage.app",
  messagingSenderId: "17077391191",
  appId: "1:17077391191:web:f167a311052c56bd3d7812"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 啟用離線本機快取，工地無訊號時依然順暢讀寫
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("離線快取狀態:", err.code);
});

// 新系統專屬集合名稱，與舊系統 100% 隔離
export const COLLECTIONS = {
  MASTER_CONFIG: "measuring_config",
  PROJECTS: "measuring_projects",
  REPORTS_PUBLIC: "measuring_public_reports"
};
