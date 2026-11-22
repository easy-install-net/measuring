import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth } from "../config/firebase-init.js";

// 偵測是否誤用 Google App / WhatsApp 內建瀏覽器（避免下載 PDF 失敗）
export function checkBrowserCompatibility() {
  const ua = navigator.userAgent || "";
  const isInApp = /GSA\/|WhatsApp|FBAN|FBAV|Line/i.test(ua);
  const banner = document.getElementById("webview-banner");
  if (banner && isInApp) {
    banner.classList.remove("hidden");
  }
}

// 渲染極簡黑白登入畫面
export function renderLoginView(container, onSuccess) {
  container.innerHTML = `
    <div class="card" style="max-width: 400px; margin: 40px auto;">
      <h2 style="margin-top:0; font-size:18px;">MEASURING 系統登入</h2>
      <p style="color:#4B5563; font-size:13px;">支援手機與電腦多端同步，登入後自動保持連線。</p>
      <form id="login-form" style="display:flex; flex-direction:column; gap:10px;">
        <input type="email" id="login-email" placeholder="電郵地址" required
               style="padding:10px; border:1px solid #111827; border-radius:4px; font-size:15px;" />
        <input type="password" id="login-pass" placeholder="密碼" required
               style="padding:10px; border:1px solid #111827; border-radius:4px; font-size:15px;" />
        <button type="submit" class="btn-solid" style="padding:10px;">進入工程系統</button>
        <div id="login-error" style="color:#DC2626; font-size:13px;"></div>
      </form>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass = document.getElementById("login-pass").value;
    const errBox = document.getElementById("login-error");
    errBox.textContent = "驗證中...";
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      if (onSuccess) onSuccess();
    } catch (err) {
      errBox.textContent = "登入失敗，請檢查電郵或密碼。";
    }
  });
}

export function watchAuth(onLoggedIn, onLoggedOut) {
  onAuthStateChanged(auth, (user) => {
    const authBtn = document.getElementById("btn-auth-action");
    if (user) {
      if (authBtn) {
        authBtn.textContent = "登出";
        authBtn.onclick = () => signOut(auth);
      }
      onLoggedIn(user);
    } else {
      if (authBtn) {
        authBtn.textContent = "未登入";
        authBtn.onclick = null;
      }
      onLoggedOut();
    }
  });
}
