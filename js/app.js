import { collection, doc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "./config/firebase-init.js";
import { loadMasterDict } from "./config/master-dict.js";
import { checkBrowserCompatibility, watchAuth, renderLoginView } from "./core/auth.js";
import { uploadMediaToCloud } from "./core/image-upload.js";
import { MeasureCanvas } from "./modules/measure-canvas.js";
import { renderAuditSplitView } from "./modules/audit-split.js";
import { renderReportBuilder } from "./modules/report-builder.js";

const root = document.getElementById("app-root");
let masterDict = null;
let currentProject = null;
let activePageIdx = 0;

checkBrowserCompatibility();

watchAuth(async () => {
  masterDict = await loadMasterDict();
  renderProjectList();
}, () => {
  renderLoginView(root);
});

async function renderProjectList() {
  root.innerHTML = `<div class="card">載入工程清單中...</div>`;
  const snap = await getDocs(collection(db, COLLECTIONS.PROJECTS));
  const projects = [];
  snap.forEach(d => projects.push({ id: d.id, ...d.data() }));
  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  root.innerHTML = `
    <div class="card" style="display:flex; flex-wrap:wrap; gap:8px;">
      <input type="text" id="new-proj-name" placeholder="輸入新工程名稱"
             style="flex:1; min-width:180px; padding:8px; border:1px solid #111827; border-radius:4px; font-size:15px;" />
      <button id="btn-create-proj" class="btn-solid">+ 建立工程</button>
      <button id="btn-import-legacy" class="btn-outline">📂 匯入舊系統工程</button>
    </div>

    <div id="legacy-import-box" class="card hidden" style="background:#F9FAFB; border:1px solid #111827;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <strong style="font-size:14px;">從舊系統（site_projects）唯讀匯入工程</strong>
        <button id="btn-close-legacy" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="legacy-list" style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#4B5563;">
        點擊上方按鈕載入舊系統清單...
      </div>
    </div>

    <div id="proj-cards">
      ${projects.map(p => `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" data-id="${p.id}">
          <div>
            <div style="font-weight:700; font-size:16px;">${p.name}</div>
            <div style="font-size:12px; color:#6B7280;">共 ${(p.pages || []).length} 個空間分頁</div>
          </div>
          <span class="btn-outline btn-sm">進入度尺 →</span>
        </div>
      `).join("") || `<div class="card" style="color:#6B7280;">尚未建立工程，請在上方輸入名稱建立，或點擊「📂 匯入舊系統工程」。</div>`}
    </div>
  `;

  document.getElementById("btn-create-proj").onclick = async () => {
    const name = document.getElementById("new-proj-name").value.trim();
    if (!name) return;
    const id = "P_" + Date.now();
    const newProj = { id, name, pages: [], updatedAt: Date.now() };
    await setDoc(doc(db, COLLECTIONS.PROJECTS, id), newProj);
    openProject(newProj);
  };

  document.getElementById("btn-import-legacy").onclick = openLegacyImporter;
  document.getElementById("btn-close-legacy").onclick = () => {
    document.getElementById("legacy-import-box").classList.add("hidden");
  };

  root.querySelectorAll("[data-id]").forEach(card => {
    card.onclick = () => {
      const found = projects.find(p => p.id === card.dataset.id);
      if (found) openProject(found);
    };
  });
}

async function openLegacyImporter() {
  const box = document.getElementById("legacy-import-box");
  const listEl = document.getElementById("legacy-list");
  box.classList.remove("hidden");
  listEl.innerHTML = `正在讀取舊系統工程清單...`;

  const snap = await getDocs(collection(db, "site_projects"));
  const legacyItems = [];
  snap.forEach(d => legacyItems.push({ docId: d.id, ...d.data() }));
  legacyItems.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  if (!legacyItems.length) {
    listEl.innerHTML = `舊系統目前沒有工程資料。`;
    return;
  }

  listEl.innerHTML = legacyItems.map((item, idx) => {
    const title = (item.name || item.title || "未命名工程").trim();
    const code = item.code || item.docId;
    const dateStr = item.date ? ` · ${item.date}` : "";
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#FFF; border:1px solid #D1D5DB; border-radius:4px;">
        <div>
          <div style="font-weight:700; color:#111827;">${title}</div>
          <div style="font-size:12px; color:#6B7280;">編號：${code}${dateStr}</div>
        </div>
        <button class="btn-solid btn-sm legacy-do-import" data-idx="${idx}">匯入此工程</button>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".legacy-do-import").forEach(btn => {
    btn.onclick = async () => {
      const target = legacyItems[Number(btn.dataset.idx)];
      btn.disabled = true;
      btn.textContent = "匯入中...";

      const mediaSnap = await getDocs(collection(db, "site_projects", target.docId, "media"));
      const mediaList = [];
      mediaSnap.forEach(m => mediaList.push({ id: m.id, ...m.data() }));

      const oldPages = Array.isArray(target.pages) ? target.pages : [];
      let convertedPages = [];

      if (oldPages.length > 0) {
        convertedPages = oldPages.map((op, i) => {
          const matchedMedia = mediaList.find(m => m.pageId === op.id || m.id === op.mediaId) || mediaList[i];
          const imgUrl = op.sitePhotoUrl || op.imageUrl || op.url || (matchedMedia && (matchedMedia.imageData || matchedMedia.dataUrl || matchedMedia.url)) || "";
          return {
            id: "PG_" + Date.now() + "_" + i,
            title: op.title || op.name || `分頁 ${i + 1}`,
            sitePhotoUrl: imgUrl,
            designPhotoUrl: op.designPhotoUrl || "",
            lines: Array.isArray(op.lines) ? op.lines : [],
            auditTickets: []
          };
        });
      } else if (mediaList.length > 0) {
        convertedPages = mediaList.map((m, i) => ({
          id: "PG_" + Date.now() + "_" + i,
          title: m.title || m.name || `舊圖 ${i + 1}`,
          sitePhotoUrl: m.imageData || m.dataUrl || m.url || m.src || "",
          designPhotoUrl: "",
          lines: Array.isArray(m.lines) ? m.lines : [],
          auditTickets: []
        }));
      }

      const newId = "P_" + Date.now();
      const baseName = (target.name || target.title || "未命名工程").trim();
      const codeTag = target.code ? ` (${target.code})` : "";
      const newProj = {
        id: newId,
        name: baseName + codeTag,
        legacySourceId: target.docId,
        pages: convertedPages,
        updatedAt: Date.now()
      };

      await setDoc(doc(db, COLLECTIONS.PROJECTS, newId), newProj);
      openProject(newProj);
    };
  });
}

function openProject(proj) {
  currentProject = proj;
  activePageIdx = 0;
  renderWorkspace();
}

async function saveCurrentProject() {
  currentProject.updatedAt = Date.now();
  await setDoc(doc(db, COLLECTIONS.PROJECTS, currentProject.id), currentProject);
}

function renderWorkspace() {
  const pages = currentProject.pages || [];
  const activePage = pages[activePageIdx];

  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="btn-back-list" class="btn-outline btn-sm">← 列表</button>
        <strong style="font-size:16px;">${currentProject.name}</strong>
      </div>
      <div style="display:flex; gap:6px;">
        <button id="btn-add-space" class="btn-outline btn-sm">+ 新增空間/櫃體</button>
        <button id="btn-open-report" class="btn-solid btn-sm">報告與客戶預覽</button>
      </div>
    </div>

    <div class="chip-grid" style="margin-bottom:10px;">
      ${pages.map((p, idx) => `
        <button class="chip ${idx === activePageIdx ? "active" : ""}" data-pidx="${idx}">${p.title}</button>
      `).join("")}
    </div>

    <div id="dict-picker-box" class="card ${pages.length === 0 ? "" : "hidden"}">
      <div class="section-title">第一步：選擇空間（可單選或搭配下方櫃體）</div>
      <div class="chip-grid" id="picker-spaces" style="margin-bottom:10px;"></div>
      <div class="section-title">第二步：選擇訂造櫃體（選填）</div>
      <div class="chip-grid" id="picker-cabs" style="margin-bottom:12px;"></div>
      <div style="display:flex; gap:8px;">
        <input type="text" id="custom-page-title" placeholder="或直接輸入自訂名稱" style="flex:1; padding:7px; border:1px solid #111827; border-radius:4px;" />
        <button id="btn-confirm-page" class="btn-solid">建立分頁</button>
      </div>
    </div>

    <div id="page-work-area"></div>
  `;

  document.getElementById("btn-back-list").onclick = renderProjectList;
  document.getElementById("btn-add-space").onclick = () => document.getElementById("dict-picker-box").classList.toggle("hidden");
  document.getElementById("btn-open-report").onclick = () => renderReportBuilder(root, currentProject, renderWorkspace);

  root.querySelectorAll("[data-pidx]").forEach(btn => {
    btn.onclick = () => { activePageIdx = Number(btn.dataset.pidx); renderWorkspace(); };
  });

  setupDictPicker();

  if (activePage) {
    renderActivePage(activePage);
  }
}

function setupDictPicker() {
  let selSpace = "";
  let selCab = "";
  const titleInput = document.getElementById("custom-page-title");
  const updateTitle = () => {
    titleInput.value = [selSpace, selCab].filter(Boolean).join(" · ");
  };

  const spaceItems = masterDict.spaceGroups.flatMap(g => g.items);
  const cabItems = masterDict.cabinetGroups.flatMap(g => g.items);

  document.getElementById("picker-spaces").innerHTML = spaceItems.map(i =>
    `<button type="button" class="chip ${i.pinned ? "chip-pinned" : ""}" data-sp="${i.name}">${i.name}</button>`
  ).join("");

  document.getElementById("picker-cabs").innerHTML = cabItems.map(i =>
    `<button type="button" class="chip ${i.pinned ? "chip-pinned" : ""}" data-cb="${i.name}">${i.name}</button>`
  ).join("");

  document.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => {
    document.querySelectorAll("[data-sp]").forEach(x => x.classList.remove("active"));
    selSpace = selSpace === b.dataset.sp ? "" : b.dataset.sp;
    if (selSpace) b.classList.add("active");
    updateTitle();
  });

  document.querySelectorAll("[data-cb]").forEach(b => b.onclick = () => {
    document.querySelectorAll("[data-cb]").forEach(x => x.classList.remove("active"));
    selCab = selCab === b.dataset.cb ? "" : b.dataset.cb;
    if (selCab) b.classList.add("active");
    updateTitle();
  });

  document.getElementById("btn-confirm-page").onclick = async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    currentProject.pages.push({
      id: "PG_" + Date.now(),
      title,
      sitePhotoUrl: "",
      designPhotoUrl: "",
      lines: [],
      auditTickets: []
    });
    activePageIdx = currentProject.pages.length - 1;
    await saveCurrentProject();
    renderWorkspace();
  };
}

function renderActivePage(page) {
  const workArea = document.getElementById("page-work-area");
  workArea.innerHTML = `
    <div class="card" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:space-between; align-items:center;">
      <div style="display:flex; gap:8px;">
        <button id="mode-measure" class="btn-solid btn-sm">📐 現場拉尺模式</button>
        <button id="mode-audit" class="btn-outline btn-sm">🔍 上下分屏審圖</button>
      </div>
      <div style="display:flex; gap:6px;">
        <label class="btn-outline btn-sm" style="cursor:pointer;">
          📷 上傳現場圖
          <input type="file" id="up-site-photo" accept="image/*" class="hidden" />
        </label>
        <label class="btn-outline btn-sm" style="cursor:pointer;">
          📄 上傳設計圖
          <input type="file" id="up-design-photo" accept="image/*" class="hidden" />
        </label>
      </div>
    </div>
    <div id="sub-module-host"></div>
  `;

  const host = document.getElementById("sub-module-host");
  const btnMeasure = document.getElementById("mode-measure");
  const btnAudit = document.getElementById("mode-audit");

  const showMeasure = () => {
    btnMeasure.className = "btn-solid btn-sm";
    btnAudit.className = "btn-outline btn-sm";
    if (!page.sitePhotoUrl) {
      host.innerHTML = `<div class="card" style="color:#4B5563; text-align:center; padding:30px;">請先點擊上方「📷 上傳現場圖」拍照或選取底圖開始拉尺。</div>`;
      return;
    }
    new MeasureCanvas(host, page.sitePhotoUrl, page.lines || [], masterDict.rulerColors, async (updatedLines) => {
      page.lines = updatedLines;
      await saveCurrentProject();
    });
  };

  const showAudit = () => {
    btnAudit.className = "btn-solid btn-sm";
    btnMeasure.className = "btn-outline btn-sm";
    renderAuditSplitView(host, page, async (updatedTickets) => {
      page.auditTickets = updatedTickets;
      await saveCurrentProject();
    });
  };

  btnMeasure.onclick = showMeasure;
  btnAudit.onclick = showAudit;

  document.getElementById("up-site-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div class="card">正在壓縮並同步現場圖至雲端...</div>`;
    const res = await uploadMediaToCloud(currentProject.id, page.id, file);
    page.sitePhotoUrl = res.imageData;
    await saveCurrentProject();
    showMeasure();
  };

  document.getElementById("up-design-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div class="card">正在壓縮並同步設計圖至雲端...</div>`;
    const res = await uploadMediaToCloud(currentProject.id, page.id, file);
    page.designPhotoUrl = res.imageData;
    await saveCurrentProject();
    showAudit();
  };

  showMeasure();
}
