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
let activePageIdx = -1; // -1 = 空間總覽網格, >= 0 = 進入單頁度尺/審圖
let filterSpace = "ALL";
let filterDocType = "ALL";

const DOC_TYPE_LABELS = {
  plan: "平面圖",
  photo: "拍攝",
  "3d": "立體圖",
  detail: "詳圖",
  render: "效果圖",
  dim: "尺吋圖"
};

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
        載入中...
      </div>
    </div>

    <div id="proj-cards">
      ${projects.map(p => `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" data-id="${p.id}">
          <div>
            <div style="font-weight:700; font-size:16px;">${p.name}</div>
            <div style="font-size:12px; color:#6B7280;">共 ${(p.pages || []).length} 頁圖紙</div>
          </div>
          <span class="btn-outline btn-sm">進入空間總覽 →</span>
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

// 萬用切片還原：自動拼接 media/{imgId}/chunks 內所有字串切片
async function reconstructChunkedImage(projectId, mediaId, mediaMeta) {
  if (!mediaId) return "";
  if (mediaMeta) {
    const direct = mediaMeta.imageData || mediaMeta.dataUrl || mediaMeta.data || mediaMeta.url || mediaMeta.src;
    if (typeof direct === "string" && direct.length > 100) return direct;
  }
  try {
    const chunksSnap = await getDocs(collection(db, "site_projects", projectId, "media", mediaId, "chunks"));
    const chunkDocs = [];
    chunksSnap.forEach(c => chunkDocs.push({ id: c.id, ...c.data() }));
    chunkDocs.sort((a, b) => {
      const na = Number(a.index ?? a.idx ?? String(a.id).replace(/\D/g, "")) || 0;
      const nb = Number(b.index ?? b.idx ?? String(b.id).replace(/\D/g, "")) || 0;
      return na - nb;
    });
    let combined = "";
    for (const cd of chunkDocs) {
      const strVal = cd.data || cd.chunk || cd.val || cd.content || cd.str ||
        Object.values(cd).find(v => typeof v === "string" && v.length > 30 && v !== cd.id) || "";
      combined += strVal;
    }
    if (combined && !combined.startsWith("data:image") && !combined.startsWith("http")) {
      combined = "data:image/jpeg;base64," + combined;
    }
    return combined;
  } catch (e) {
    return "";
  }
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
        <button class="btn-solid btn-sm legacy-do-import" data-idx="${idx}">匯入並還原圖紙</button>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".legacy-do-import").forEach(btn => {
    btn.onclick = async () => {
      const target = legacyItems[Number(btn.dataset.idx)];
      btn.disabled = true;
      btn.textContent = "讀取分頁與切片中...";

      const [pagesSnap, mediaSnap] = await Promise.all([
        getDocs(collection(db, "site_projects", target.docId, "pages")),
        getDocs(collection(db, "site_projects", target.docId, "media"))
      ]);

      const rawPagesMap = {};
      pagesSnap.forEach(d => { rawPagesMap[d.id] = { docId: d.id, ...d.data() }; });

      const mediaMap = {};
      const mediaList = [];
      mediaSnap.forEach(m => {
        const obj = { id: m.id, ...m.data() };
        mediaMap[m.id] = obj;
        mediaList.push(obj);
      });

      const deletedSet = new Set(target.deletedPageIds || []);
      const orderedIds = Array.isArray(target.pageIds) && target.pageIds.length > 0
        ? target.pageIds.filter(id => rawPagesMap[id] && !deletedSet.has(id))
        : Object.keys(rawPagesMap).filter(id => !deletedSet.has(id));

      const convertedPages = [];
      for (let i = 0; i < orderedIds.length; i++) {
        btn.textContent = `還原圖紙 (${i + 1}/${orderedIds.length})...`;
        const pg = rawPagesMap[orderedIds[i]];
        const spaceName = (pg.space || pg.room || pg.zone || pg.area || pg.category || pg.group || "未分類空間").trim();
        const rawDocType = pg.docType || "photo";
        const typeLabel = DOC_TYPE_LABELS[rawDocType] || rawDocType;

        let matchedMediaId = pg.mediaId || pg.imgId || pg.imageId || pg.photoId || "";
        if (!matchedMediaId) {
          const prefix = String(pg.id || pg.docId).replace(/^pg_/, "img_").split("_").slice(0, 2).join("_");
          const foundM = mediaList.find(m => m.id.startsWith(prefix)) || mediaList[i];
          if (foundM) matchedMediaId = foundM.id;
        }

        const imgUrl = await reconstructChunkedImage(target.docId, matchedMediaId, mediaMap[matchedMediaId]);
        const oldLines = Array.isArray(pg.lines) ? pg.lines : [];
        const oldPins = Array.isArray(pg.pins) ? pg.pins : [];

        convertedPages.push({
          id: pg.id || pg.docId || ("PG_" + Date.now() + "_" + i),
          pageNum: `P${i + 1}`,
          space: spaceName,
          docType: rawDocType,
          docTypeLabel: typeLabel,
          title: `${spaceName} · ${typeLabel}`,
          author: pg.author || target.lastModifiedBy || "",
          date: pg.date || target.date || "",
          badgeCount: oldLines.length + oldPins.length,
          sitePhotoUrl: imgUrl,
          designPhotoUrl: "",
          lines: oldLines,
          pins: oldPins,
          auditTickets: []
        });
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
  activePageIdx = -1;
  filterSpace = "ALL";
  filterDocType = "ALL";
  renderWorkspace();
}

async function saveCurrentProject() {
  currentProject.updatedAt = Date.now();
  await setDoc(doc(db, COLLECTIONS.PROJECTS, currentProject.id), currentProject);
}

function renderWorkspace() {
  if (activePageIdx >= 0 && currentProject.pages[activePageIdx]) {
    renderSinglePageEditor(currentProject.pages[activePageIdx]);
    return;
  }
  renderSpatialGridOverview();
}

// 空間獨立分區 ＋ 雙層篩選 ＋ 三欄縮圖網格總覽（對齊舊系統佈局）
function renderSpatialGridOverview() {
  const pages = currentProject.pages || [];
  const allSpaces = [...new Set(pages.map(p => p.space || "未分類空間"))];

  const typeCounts = { ALL: pages.length };
  pages.forEach(p => {
    const lbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
    typeCounts[lbl] = (typeCounts[lbl] || 0) + 1;
  });

  const filteredPages = pages.filter(p => {
    const spOk = filterSpace === "ALL" || (p.space || "未分類空間") === filterSpace;
    const lbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
    const tpOk = filterDocType === "ALL" || lbl === filterDocType;
    return spOk && tpOk;
  });

  // 依空間分組
  const groups = {};
  filteredPages.forEach(p => {
    const sp = p.space || "未分類空間";
    if (!groups[sp]) groups[sp] = [];
    groups[sp].push(p);
  });

  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="btn-back-list" class="btn-outline btn-sm">← 目錄</button>
        <strong style="font-size:16px;">${currentProject.name}</strong>
        <span style="font-size:12px; color:#6B7280;">(${filteredPages.length}/${pages.length}頁)</span>
      </div>
      <div style="display:flex; gap:6px;">
        <button id="btn-add-space" class="btn-outline btn-sm">+ 新增空間/圖紙</button>
        <button id="btn-open-report" class="btn-solid btn-sm">報告與客戶預覽</button>
      </div>
    </div>

    <!-- 雙層篩選列 -->
    <div class="card" style="padding:10px; margin-bottom:10px;">
      <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #E5E7EB;">
        <button class="chip ${filterSpace === "ALL" ? "active" : ""}" data-fsp="ALL">全部空間</button>
        ${allSpaces.map(sp => `
          <button class="chip ${filterSpace === sp ? "active" : ""}" data-fsp="${sp}">${sp}</button>
        `).join("")}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
        <button class="chip ${filterDocType === "ALL" ? "active" : ""}" data-ftp="ALL">全部(${pages.length})</button>
        ${Object.keys(typeCounts).filter(k => k !== "ALL").map(lbl => `
          <button class="chip ${filterDocType === lbl ? "active" : ""}" data-ftp="${lbl}">${lbl}(${typeCounts[lbl]})</button>
        `).join("")}
      </div>
    </div>

    <!-- 新增空間/圖紙展開盒 -->
    <div id="dict-picker-box" class="card ${pages.length === 0 ? "" : "hidden"}">
      <div class="section-title">第一步：選擇空間</div>
      <div class="chip-grid" id="picker-spaces" style="margin-bottom:10px;"></div>
      <div class="section-title">第二步：選擇訂造櫃體 / 圖紙類型（選填）</div>
      <div class="chip-grid" id="picker-cabs" style="margin-bottom:12px;"></div>
      <div style="display:flex; gap:8px;">
        <input type="text" id="custom-page-title" placeholder="空間名稱（如：玄關、主人房）" style="flex:1; padding:7px; border:1px solid #111827; border-radius:4px;" />
        <select id="new-page-doctype" style="padding:7px; border:1px solid #111827; border-radius:4px;">
          <option value="拍攝">拍攝</option>
          <option value="平面圖">平面圖</option>
          <option value="立體圖">立體圖</option>
          <option value="詳圖">詳圖</option>
          <option value="效果圖">效果圖</option>
          <option value="尺吋圖">尺吋圖</option>
        </select>
        <button id="btn-confirm-page" class="btn-solid">建立</button>
      </div>
    </div>

    <!-- 空間獨立分區區塊 + 三欄縮圖網格 -->
    <div id="spatial-sections" style="display:flex; flex-direction:column; gap:14px;">
      ${Object.entries(groups).map(([spaceName, items]) => `
        <div style="background:#F8FAFC; border:1.5px solid #CBD5E1; border-radius:8px; padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-weight:700; font-size:15px; color:#1E293B;">
              📁 ${spaceName} <span style="font-weight:400; color:#64748B; font-size:13px;">(${items.length} 頁)</span>
            </div>
            <span style="font-size:11px; color:#64748B; background:#E2E8F0; padding:2px 8px; border-radius:4px;">獨立空間分區</span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px;">
            ${items.map(p => {
              const realIdx = pages.indexOf(p);
              const pNum = p.pageNum || `P${realIdx + 1}`;
              const tLbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
              const count = (p.lines || []).length + (p.pins || []).length;
              const shortDate = (p.date || "").slice(5);
              return `
                <div class="page-grid-card" data-open-idx="${realIdx}"
                     style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column;">
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid #F1F5F9; font-size:12px;">
                    <span style="font-weight:700; color:#2563EB; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${pNum} ${p.space || spaceName} · ${tLbl}
                    </span>
                    <span style="background:#111827; color:#FFF; padding:1px 6px; border-radius:3px; font-size:11px;">度尺</span>
                  </div>
                  <div style="position:relative; height:155px; background:#F1F5F9; display:flex; align-items:center; justify-content:center;">
                    ${p.sitePhotoUrl
                      ? `<img src="${p.sitePhotoUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                      : `<span style="color:#94A3B8; font-size:12px;">尚未上傳圖紙</span>`}
                    ${count > 0
                      ? `<span style="position:absolute; top:6px; right:6px; background:#1E293B; color:#FFF; font-size:11px; padding:2px 6px; border-radius:4px;">📐 ${count}標註</span>`
                      : ""}
                    ${(shortDate || p.author)
                      ? `<span style="position:absolute; bottom:6px; right:6px; background:rgba(255,255,255,0.9); color:#475569; font-size:11px; padding:1px 6px; border-radius:3px; border:1px solid #E2E8F0;">${shortDate} ${p.author || ""}</span>`
                      : ""}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("btn-back-list").onclick = renderProjectList;
  document.getElementById("btn-add-space").onclick = () => document.getElementById("dict-picker-box").classList.toggle("hidden");
  document.getElementById("btn-open-report").onclick = () => renderReportBuilder(root, currentProject, renderWorkspace);

  root.querySelectorAll("[data-fsp]").forEach(btn => {
    btn.onclick = () => { filterSpace = btn.dataset.fsp; renderSpatialGridOverview(); };
  });
  root.querySelectorAll("[data-ftp]").forEach(btn => {
    btn.onclick = () => { filterDocType = btn.dataset.ftp; renderSpatialGridOverview(); };
  });
  root.querySelectorAll("[data-open-idx]").forEach(card => {
    card.onclick = () => { activePageIdx = Number(card.dataset.openIdx); renderWorkspace(); };
  });

  setupDictPicker();
}

function setupDictPicker() {
  let selSpace = "";
  let selCab = "";
  const titleInput = document.getElementById("custom-page-title");
  if (!titleInput) return;

  const updateTitle = () => {
    titleInput.value = [selSpace, selCab].filter(Boolean).join("-");
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
    const spaceVal = titleInput.value.trim();
    const docTypeVal = document.getElementById("new-page-doctype").value;
    if (!spaceVal) return;
    currentProject.pages.push({
      id: "PG_" + Date.now(),
      pageNum: `P${currentProject.pages.length + 1}`,
      space: spaceVal,
      docTypeLabel: docTypeVal,
      title: `${spaceVal} · ${docTypeVal}`,
      sitePhotoUrl: "",
      designPhotoUrl: "",
      lines: [],
      pins: [],
      auditTickets: []
    });
    activePageIdx = currentProject.pages.length - 1;
    await saveCurrentProject();
    renderWorkspace();
  };
}

function renderSinglePageEditor(page) {
  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="btn-back-grid" class="btn-outline btn-sm">← 返回空間總覽</button>
        <strong style="font-size:15px;">${page.pageNum || ""} ${page.space || ""} · ${page.docTypeLabel || ""}</strong>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="mode-measure" class="btn-solid btn-sm">📐 現場拉尺模式</button>
        <button id="mode-audit" class="btn-outline btn-sm">🔍 上下分屏審圖</button>
      </div>
      <div style="display:flex; gap:6px;">
        <label class="btn-outline btn-sm" style="cursor:pointer;">
          📷 更換現場圖
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

  document.getElementById("btn-back-grid").onclick = () => {
    activePageIdx = -1;
    renderWorkspace();
  };

  const host = document.getElementById("sub-module-host");
  const btnMeasure = document.getElementById("mode-measure");
  const btnAudit = document.getElementById("mode-audit");

  const showMeasure = () => {
    btnMeasure.className = "btn-solid btn-sm";
    btnAudit.className = "btn-outline btn-sm";
    if (!page.sitePhotoUrl) {
      host.innerHTML = `<div class="card" style="color:#4B5563; text-align:center; padding:30px;">請先點擊上方「📷 更換現場圖」拍照或選取底圖開始拉尺。</div>`;
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
