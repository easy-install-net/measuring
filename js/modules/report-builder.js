import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "../config/firebase-init.js";

export function renderReportBuilder(container, project, onClose) {
  const pages = project.pages || [];

  container.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0; font-size:16px;">報告自訂勾選與客戶預覽</h3>
        <button id="rb-close" class="btn-outline btn-sm">返回工程</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; padding:10px; background:#F9FAFB; border:1px solid #D1D5DB; border-radius:4px; margin-bottom:12px;">
        <label style="display:flex; align-items:center; gap:8px; font-weight:600;">
          <input type="checkbox" id="rb-inc-dims" checked style="width:17px; height:17px; accent-color:#111827;" />
          包含已勾選「納入報告」的現場尺寸清單
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-weight:600;">
          <input type="checkbox" id="rb-inc-audit" checked style="width:17px; height:17px; accent-color:#111827;" />
          包含審圖批核問題卡（🔴衝突 / 🟡待確認 / 🟢通過）
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-weight:600;">
          <input type="checkbox" id="rb-inc-photos" checked style="width:17px; height:17px; accent-color:#111827;" />
          包含現場實測標註圖片
        </label>
      </div>

      <div class="section-title">選擇要公開的空間分頁</div>
      <div id="rb-page-checks" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
        ${pages.map((p, i) => `
          <label class="chip active" style="display:flex; align-items:center; gap:5px;">
            <input type="checkbox" class="rb-page-chk" data-idx="${i}" checked style="accent-color:#FFF;" />
            ${p.title}
          </label>
        `).join("") || `<span style="color:#6B7280; font-size:13px;">暫無分頁</span>`}
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        <button id="rb-gen-link" class="btn-solid">🔗 生成客戶專用唯讀預覽連結</button>
        <button id="rb-print-pdf" class="btn-outline">🖨️ 匯出 / 列印 A4 報告</button>
      </div>

      <div id="rb-link-result" class="hidden" style="margin-top:12px; padding:10px; border:1px solid #111827; border-radius:4px; background:#FFF;">
        <div style="font-size:12px; font-weight:700; margin-bottom:4px;">客戶唯讀預覽連結（底層鎖死防修改）：</div>
        <input type="text" id="rb-share-url" readonly style="width:100%; padding:6px; border:1px solid #D1D5DB; font-size:13px; margin-bottom:6px;" />
        <button id="rb-copy-btn" class="btn-solid btn-sm">複製連結發送給客戶</button>
      </div>
    </div>
  `;

  container.querySelector("#rb-close").onclick = onClose;
  container.querySelector("#rb-print-pdf").onclick = () => window.print();

  container.querySelector("#rb-gen-link").onclick = async () => {
    const incDims = container.querySelector("#rb-inc-dims").checked;
    const incAudit = container.querySelector("#rb-inc-audit").checked;
    const incPhotos = container.querySelector("#rb-inc-photos").checked;
    const selectedIdx = Array.from(container.querySelectorAll(".rb-page-chk:checked")).map(el => Number(el.dataset.idx));

    const token = project.publicToken || ("p_" + Math.random().toString(36).slice(2) + Date.now().toString(36));
    const filteredPages = selectedIdx.map(i => {
      const p = pages[i];
      return {
        title: p.title,
        sitePhotoUrl: incPhotos ? (p.sitePhotoUrl || "") : "",
        lines: incDims ? (p.lines || []).filter(l => l.includeInReport) : [],
        auditTickets: incAudit ? (p.auditTickets || []) : []
      };
    });

    await setDoc(doc(db, COLLECTIONS.REPORTS_PUBLIC, token), {
      projectName: project.name,
      updatedAt: Date.now(),
      version: "v" + new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      pages: filteredPages
    });

    const baseUrl = window.location.href.replace(/index\.html.*$/, "").replace(/\/$/, "");
    const shareUrl = `${baseUrl}/preview.html?token=${token}`;

    const resBox = container.querySelector("#rb-link-result");
    const urlInput = container.querySelector("#rb-share-url");
    resBox.classList.remove("hidden");
    urlInput.value = shareUrl;

    container.querySelector("#rb-copy-btn").onclick = () => {
      urlInput.select();
      navigator.clipboard.writeText(shareUrl);
      container.querySelector("#rb-copy-btn").textContent = "✓ 已複製連結";
    };
  };
}
