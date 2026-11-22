import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth } from "../config/firebase-init.js";

export function checkBrowserCompatibility() {
  if (!window.indexedDB || !window.fetch) {
    alert("請使用最新版的 Chrome 或 Safari 瀏覽器以確保完整功能。");
  }
}

// 免登入直入模式：背景靜默建立匿名連線，打開網頁直接進入工程系統
export function watchAuth(onLoggedIn) {
  const statusBtn = document.getElementById("auth-status-btn");
  if (statusBtn) {
    statusBtn.textContent = "雲端連線中";
    statusBtn.style.cursor = "default";
  }

  let started = false;
  const boot = (user) => {
    if (statusBtn) statusBtn.textContent = "已連線";
    if (!started) {
      started = true;
      onLoggedIn(user || { uid: "local_guest" });
    }
  };

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      boot(user);
    } else {
      try {
        const res = await signInAnonymously(auth);
        boot(res.user);
      } catch (_) {
        // 即使未啟用匿名登入或離線，也直接放行進入系統
        boot(null);
      }
    }
  });
}

export function renderLoginView() {
  // 免登入模式下不顯示登入攔截畫面
}
