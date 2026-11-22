import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth } from "../config/firebase-init.js";

export function checkBrowserCompatibility() {
  if (!window.indexedDB || !window.fetch) {
    alert("請使用最新版的 Chrome 或 Safari 瀏覽器以確保完整功能。");
  }
}

export function watchAuth(onLoggedIn, onLoggedOut) {
  const statusBtn = document.getElementById("auth-status-btn");
  setPersistence(auth, browserLocalPersistence).catch(() => {});

  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (statusBtn) {
        statusBtn.textContent = "登出";
        statusBtn.onclick = () => signOut(auth);
      }
      onLoggedIn(user);
    } else {
      if (statusBtn) {
        statusBtn.textContent = "未登入";
        statusBtn.onclick = null;
      }
      onLoggedOut();
    }
  });
}

export function renderLoginView(root) {
  root.innerHTML = `
    <div class="card" style="max-width:400px; margin:40px auto; text-align:center; padding:28px 20px;">
      <div style="font-size:20px; font-weight:700; margin-bottom:8px;">MEASURING 系統登入</div>
      <div style="font-size:13px; color:#6B7280; margin-bottom:22px;">
        使用與舊系統相同的 Google 帳號一鍵登入，自動保持連線。
      </div>
      <button id="btn-google-login" class="btn-solid" style="width:100%; padding:12px; font-size:15px; display:flex; align-items:center; justify-content:center; gap:8px;">
        <span>G</span>
        <span>使用 Google 帳號一鍵登入</span>
      </button>
      <div id="login-err-msg" style="color:#DC2626; font-size:12px; margin-top:12px;"></div>
    </div>
  `;

  document.getElementById("btn-google-login").onclick = async () => {
    const btn = document.getElementById("btn-google-login");
    const errEl = document.getElementById("login-err-msg");
    btn.disabled = true;
    errEl.textContent = "";
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (e) {
      btn.disabled = false;
      errEl.textContent = "登入失敗：" + (e.message || e.code);
    }
  };
}
