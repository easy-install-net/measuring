import { collection, doc, getDoc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
let activePageIdx = -1;
let viewMode = "FOLDER";
let filterSpace = "ALL";
let filterDocType = "ALL";
let folderCoverIndex = {};
const memoryPhotoCache = new Map(); // 記憶體快取，瞬間切換圖紙不卡頓

const DOC_TYPE_LABELS = {
  plan: "平面圖",
  photo: "拍攝",
  "3d": "立體圖",
  detail: "詳圖",
  render: "效果圖",
  dim: "尺吋圖"
};

const DOC_TYPE_RANK = { plan: 1, photo: 2, "3d": 3, dim: 4, detail: 5, render: 6 };

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
      <div id="legacy-status-msg" style="font-size:12px; color:#DC2626; margin-bottom:6px;"></div>
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
          <span class="btn-outline btn-sm">進入空間圖集 →</span>
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
    card.onclick = async () => {
      const found = projects.find(p => p.id === card.dataset.id);
      if (found) await openProjectWithHydration(found);
    };
  });
}

// 取得分頁圖片：優先從記憶體快取 / 舊系統切片 / 新系統獨立媒體庫載入
async function hydrateProjectPhotos(proj) {
  const pages = proj.pages || [];
  await Promise.all(pages.map(async (p) => {
    if (p.sitePhotoUrl && p.sitePhotoUrl.length > 50) {
      memoryPhotoCache.set(p.id, p.sitePhotoUrl);
      return;
    }
    if (memoryPhotoCache.has(p.id)) {
      p.sitePhotoUrl = memoryPhotoCache.get(p.id);
      return;
    }
    // 1. 嘗試從新系統獨立媒體表讀取
    if (p.mediaRefId) {
      try {
        const mDoc = await getDoc(doc(db, COLLECTIONS.MEDIA, p.mediaRefId));
        if (mDoc.exists() && mDoc.data().imageData) {
          p.sitePhotoUrl = mDoc.data().imageData;
          memoryPhotoCache.set(p.id, p.sitePhotoUrl);
          return;
        }
      } catch (_) {}
    }
    // 2. 若有舊系統來源，直接即時還原切片（保證 100% 不受 1MB 限制）
    if (proj.legacySourceId && p.legacyMediaId) {
      const url = await resolveLegacyMediaPhoto(proj.legacySourceId, p.legacyMediaId, { chunked: true });
      if (url) {
        p.sitePhotoUrl = url;
        memoryPhotoCache.set(p.id, url);
      }
    }
  }));
}

async function openProjectWithHydration(proj) {
  root.innerHTML = `<div class="card">正在載入空間圖集與高清底圖...</div>`;
  await hydrateProjectPhotos(proj);
  openProject(proj);
}

async function resolveLegacyMediaPhoto(projectDocId, mediaDocId, mediaMeta) {
  if (!mediaDocId) return "";
  if (mediaMeta && mediaMeta.photo) return mediaMeta.photo;
  try {
    const chunksSnap = await getDocs(collection(db, "site_projects", String(projectDocId), "media", String(mediaDocId), "chunks"));
    const list = [];
    chunksSnap.forEach(c => list.push(c.data()));
    if (!list.length) return "";
    list.sort((a, b) => (a.index || 0) - (b.index || 0));
    let combined = list.map(c => c.data || "").join("");
    if (combined && !combined.startsWith("data:image") && !combined.startsWith("http")) {
      combined = "data:image/jpeg;base64," + combined;
    }
    return combined;
  } catch (_) {
    return "";
  }
}

async function openLegacyImporter() {
  const box = document.getElementById("legacy-import-box");
  const listEl = document.getElementById("legacy-list");
  const statusEl = document.getElementById("legacy-status-msg");
  box.classList.remove("hidden");
  statusEl.textContent = "";
  listEl.innerHTML = `正在讀取舊系統工程清單...`;

  try {
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
      const pgCount = Array.isArray(item.pageIds) ? item.pageIds.length : 0;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#FFF; border:1px solid #D1D5DB; border-radius:4px;">
          <div>
            <div style="font-weight:700; color:#111827;">${title}</div>
            <div style="font-size:12px; color:#6B7280;">編號：${code}${dateStr} · 記錄 ${pgCount} 頁</div>
          </div>
          <button class="btn-solid btn-sm legacy-do-import" data-idx="${idx}">匯入並還原圖集</button>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".legacy-do-import").forEach(btn => {
      btn.onclick = async () => {
        const target = legacyItems[Number(btn.dataset.idx)];
        btn.disabled = true;
        btn.textContent = "讀取分頁與圖庫中...";
        statusEl.textContent = "";

        try {
          const [pagesSnap, mediaSnap] = await Promise.all([
            getDocs(collection(db, "site_projects", String(target.docId), "pages")),
            getDocs(collection(db, "site_projects", String(target.docId), "media"))
          ]);

          const rawPagesMap = {};
          pagesSnap.forEach(d => {
            rawPagesMap[String(d.id)] = { docId: String(d.id), ...d.data() };
          });

          const mediaMetaMap = new Map();
          const mediaIdsList = [];
          mediaSnap.forEach(m => {
            const idStr = String(m.id);
            mediaMetaMap.set(idStr, m.data() || {});
            mediaIdsList.push(idStr);
          });

          const deletedSet = new Set((target.deletedPageIds || []).map(String));
          const orderedIds = Array.isArray(target.pageIds) && target.pageIds.length > 0
            ? target.pageIds.map(String).filter(id => rawPagesMap[id] && !deletedSet.has(id))
            : Object.keys(rawPagesMap).filter(id => !deletedSet.has(id));

          Object.keys(rawPagesMap).forEach(id => {
            if (!deletedSet.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
          });

          const newId = "P_" + Date.now();
          const convertedPagesForDb = [];
          const convertedPagesForMemory = [];

          for (let i = 0; i < orderedIds.length; i++) {
            btn.textContent = `還原圖紙 (${i + 1}/${orderedIds.length})...`;
            const pg = rawPagesMap[orderedIds[i]];
            const pageIdStr = String(pg.id || pg.docId);

            const rawSpace = (Array.isArray(pg.spaces) && pg.spaces[0]) ? pg.spaces[0] : (pg.space || "");
            const spaceName = String(rawSpace).trim() || "未標空間";

            const rawDocType = pg.docType || "photo";
            const typeLabel = DOC_TYPE_LABELS[rawDocType] || rawDocType;

            let matchedMediaId = "";
            if (pg.photoId && mediaMetaMap.has(String(pg.photoId))) matchedMediaId = String(pg.photoId);
            else if (mediaMetaMap.has("page_" + pageIdStr)) matchedMediaId = "page_" + pageIdStr;
            else if (mediaIdsList[i]) matchedMediaId = mediaIdsList[i];

            let imgUrl = "";
            if (matchedMediaId) {
              imgUrl = await resolveLegacyMediaPhoto(target.docId, matchedMediaId, mediaMetaMap.get(matchedMediaId));
            }
            if (!imgUrl && pg.photo) imgUrl = pg.photo;

            // 分拆存入 measuring_media（單張獨立存放，避開 Firestore 1MB 文件上限）
            let mediaRefId = "";
            if (imgUrl && imgUrl.length < 900000) {
              mediaRefId = `${newId}_${pageIdStr}`;
              await setDoc(doc(db, COLLECTIONS.MEDIA, mediaRefId), {
                projectId: newId,
                pageId: pageIdStr,
                imageData: imgUrl,
                updatedAt: Date.now()
              }).catch(() => { mediaRefId = ""; });
            }

            memoryPhotoCache.set(pageIdStr, imgUrl);

            const basePageMeta = {
              id: pageIdStr,
              pageNum: `P${i + 1}`,
              space: spaceName,
              docType: rawDocType,
              docTypeLabel: typeLabel,
              title: `${spaceName} · ${typeLabel}`,
              author: pg.author || target.lastModifiedBy || "",
              date: pg.date || target.date || "",
              mediaRefId,
              legacyMediaId: matchedMediaId,
              designPhotoUrl: "",
              lines: Array.isArray(pg.lines) ? pg.lines : [],
              markers: Array.isArray(pg.markers) ? pg.markers : [],
              pins: Array.isArray(pg.pins) ? pg.pins : [],
              auditTickets: []
            };

            // 寫入 Firestore 總表時不塞入巨大 base64，確保瞬間寫入成功！
            convertedPagesForDb.push({ ...basePageMeta, sitePhotoUrl: "" });
            // 記憶體內保留完整圖片，立刻秒開圖集！
            convertedPagesForMemory.push({ ...basePageMeta, sitePhotoUrl: imgUrl });
          }

          const baseName = (target.name || target.title || "未命名工程").trim();
          const codeTag = target.code ? ` (${target.code})` : "";

          await setDoc(doc(db, COLLECTIONS.PROJECTS, newId), {
            id: newId,
            name: baseName + codeTag,
            legacySourceId: String(target.docId),
            spaceOrder: Array.isArray(target.spaceOrder) ? target.spaceOrder : [],
            pages: convertedPagesForDb,
            updatedAt: Date.now()
          });

          openProject({
            id: newId,
            name: baseName + codeTag,
            legacySourceId: String(target.docId),
            spaceOrder: Array.isArray(target.spaceOrder) ? target.spaceOrder : [],
            pages: convertedPagesForMemory,
            updatedAt: Date.now()
          });
        } catch (err) {
          statusEl.textContent = `❌ 匯入失敗：${err.message || err}`;
          btn.disabled = false;
          btn.textContent = "重試匯入";
        }
      };
    });
  } catch (e) {
    statusEl.textContent = `❌ 讀取舊清單失敗：${e.message || e}`;
  }
}

function openProject(proj) {
  currentProject = proj;
  activePageIdx = -1;
  viewMode = "FOLDER";
  filterSpace = "ALL";
  filterDocType = "ALL";
  folderCoverIndex = {};
  renderWorkspace();
}

async function saveCurrentProject() {
  currentProject.updatedAt = Date.now();
  // 儲存總表時把 base64 剝離（避免超過 1MB），圖片全存在記憶體與獨立媒體庫
  const slimPages = (currentProject.pages || []).map(p => {
    if (p.sitePhotoUrl) memoryPhotoCache.set(p.id, p.sitePhotoUrl);
    return { ...p, sitePhotoUrl: "" };
  });
  await setDoc(doc(db, COLLECTIONS.PROJECTS, currentProject.id), {
    ...currentProject,
    pages: slimPages
  });
}

function getSpaceRank(sp) {
  if (!sp || sp === "未標空間") return 999;
  if (sp === "總圖") return 0;
  const order = currentProject?.spaceOrder || [];
  const idx = order.indexOf(sp);
  return idx === -1 ? 500 : idx + 1;
}

function renderWorkspace() {
  if (activePageIdx >= 0 && currentProject.pages[activePageIdx]) {
    renderSinglePageEditor(currentProject.pages[activePageIdx]);
    return;
  }
  renderOverview();
}

function renderOverview() {
  const pages = currentProject.pages || [];
  const allSpaces = [...new Set(pages.map(p => p.space || "未標空間"))].sort((a, b) => getSpaceRank(a) - getSpaceRank(b));

  const typeCounts = { ALL: pages.length };
  pages.forEach(p => {
    const lbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
    typeCounts[lbl] = (typeCounts[lbl] || 0) + 1;
  });

  const filteredPages = pages.filter(p => {
    const spOk = filterSpace === "ALL" || (p.space || "未標空間") === filterSpace;
    const lbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
    const tpOk = filterDocType === "ALL" || lbl === filterDocType;
    return spOk && tpOk;
  });

  const groupsMap = new Map();
  filteredPages.forEach(p => {
    const sp = p.space || "未標空間";
    if (!groupsMap.has(sp)) groupsMap.set(sp, []);
    groupsMap.get(sp).push(p);
  });

  const sortedGroups = Array.from(groupsMap.entries())
    .sort((a, b) => getSpaceRank(a[0]) - getSpaceRank(b[0]))
    .map(([sp, items]) => [
      sp,
      [...items].sort((a, b) => (DOC_TYPE_RANK[a.docType] || 7) - (DOC_TYPE_RANK[b.docType] || 7))
    ]);

  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="btn-back-list" class="btn-outline btn-sm">‹ 目錄</button>
        <strong style="font-size:16px;">${currentProject.name}</strong>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button id="btn-add-space" class="btn-outline btn-sm">+ 空間</button>
        <button id="btn-open-report" class="btn-solid btn-sm">報告與客戶預覽</button>
      </div>
    </div>

    <div class="card" style="padding:10px; margin-bottom:10px;">
      <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #E5E7EB;">
        <span style="font-size:12px; color:#6B7280; margin-right:2px;">${filteredPages.length}/${pages.length}頁</span>
        <button id="btn-mode-folder" class="chip ${viewMode === "FOLDER" ? "active" : ""}">🗂️ 圖集</button>
        <button id="btn-mode-expanded" class="chip ${viewMode === "EXPANDED" ? "active" : ""}">⊞ 展開</button>
        <span style="color:#D1D5DB;">|</span>
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

    <div id="dict-picker-box" class="card ${pages.length === 0 ? "" : "hidden"}">
      <div class="section-title">第一步：選擇空間</div>
      <div class="chip-grid" id="picker-spaces" style="margin-bottom:10px;"></div>
      <div class="section-title">第二步：選擇訂造櫃體（選填）</div>
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

    <div id="main-gallery-host"></div>
  `;

  document.getElementById("btn-back-list").onclick = renderProjectList;
  document.getElementById("btn-add-space").onclick = () => document.getElementById("dict-picker-box").classList.toggle("hidden");
  document.getElementById("btn-open-report").onclick = () => renderReportBuilder(root, currentProject, renderWorkspace);

  document.getElementById("btn-mode-folder").onclick = () => { viewMode = "FOLDER"; renderOverview(); };
  document.getElementById("btn-mode-expanded").onclick = () => { viewMode = "EXPANDED"; renderOverview(); };

  root.querySelectorAll("[data-fsp]").forEach(btn => {
    btn.onclick = () => {
      filterSpace = btn.dataset.fsp;
      if (filterSpace !== "ALL") viewMode = "EXPANDED";
      renderOverview();
    };
  });
  root.querySelectorAll("[data-ftp]").forEach(btn => {
    btn.onclick = () => { filterDocType = btn.dataset.ftp; renderOverview(); };
  });

  setupDictPicker();

  const galleryHost = document.getElementById("main-gallery-host");
  if (viewMode === "FOLDER" && filterSpace === "ALL") {
    renderFolderGrid(galleryHost, sortedGroups, pages);
  } else {
    renderExpandedSections(galleryHost, sortedGroups, pages);
  }
}

function renderFolderGrid(host, sortedGroups, allPages) {
  host.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px;">
      ${sortedGroups.map(([spaceName, items]) => {
        const activeSubIdx = Math.min(folderCoverIndex[spaceName] || 0, items.length - 1);
        const coverPage = items[activeSubIdx];
        const coverType = coverPage.docTypeLabel || DOC_TYPE_LABELS[coverPage.docType] || "拍攝";
        const previewThumbs = items.slice(0, 4);
        const extraCount = items.length - 4;

        return `
          <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#F8FAFC; border-bottom:1px solid #E2E8F0;">
              <strong style="font-size:15px; color:#1E293B;">${spaceName}</strong>
              <span style="font-size:12px; color:#64748B;">${items.length}張</span>
            </div>

            <div style="padding:4px 12px 0 12px; font-size:12px; color:#64748B;">
              ${coverType}
            </div>

            <div class="folder-main-preview" data-open-page="${allPages.indexOf(coverPage)}"
                 style="height:185px; margin:6px 12px; background:#F1F5F9; border-radius:4px; display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden;">
              ${coverPage.sitePhotoUrl
                ? `<img src="${coverPage.sitePhotoUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                : `<span style="color:#94A3B8; font-size:12px;">尚未上傳圖紙</span>`}
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-top:1px solid #F1F5F9; background:#FAFAFA;">
              <div style="display:flex; align-items:center; gap:4px;">
                ${previewThumbs.map((tp, tIdx) => `
                  <div class="mini-thumb-btn" data-thumb-space="${spaceName}" data-thumb-idx="${tIdx}"
                       style="width:32px; height:32px; border-radius:3px; overflow:hidden; cursor:pointer; border:${tIdx === activeSubIdx ? "2px solid #2563EB" : "1px solid #CBD5E1"}; background:#FFF;">
                    ${tp.sitePhotoUrl
                      ? `<img src="${tp.sitePhotoUrl}" style="width:100%; height:100%; object-fit:cover;" />`
                      : `<div style="width:100%; height:100%; background:#E2E8F0;"></div>`}
                  </div>
                `).join("")}
                ${extraCount > 0 ? `<span style="font-size:12px; color:#64748B; margin-left:2px;">+${extraCount}</span>` : ""}
              </div>
              <button class="folder-expand-btn" data-expand-space="${spaceName}"
                      style="background:none; border:none; color:#4F46E5; font-size:12px; font-weight:600; cursor:pointer; padding:4px;">
                展開 ›
              </button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  host.querySelectorAll(".mini-thumb-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      folderCoverIndex[btn.dataset.thumbSpace] = Number(btn.dataset.thumbIdx);
      renderOverview();
    };
  });

  host.querySelectorAll(".folder-expand-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      filterSpace = btn.dataset.expandSpace;
      viewMode = "EXPANDED";
      renderOverview();
    };
  });

  host.querySelectorAll(".folder-main-preview").forEach(box => {
    box.onclick = () => {
      activePageIdx = Number(box.dataset.openPage);
      renderWorkspace();
    };
  });
}

function renderExpandedSections(host, sortedGroups, allPages) {
  host.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">
      ${sortedGroups.map(([spaceName, items]) => `
        <div style="background:#F8FAFC; border:1.5px solid #CBD5E1; border-radius:8px; padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-weight:700; font-size:15px; color:#1E293B;">
              📁 ${spaceName} <span style="font-weight:400; color:#64748B; font-size:13px;">(${items.length} 頁)</span>
            </div>
            ${filterSpace !== "ALL"
              ? `<button class="btn-outline btn-sm btn-back-all-folders">‹ 返回全部圖集</button>`
              : `<span style="font-size:11px; color:#64748B; background:#E2E8F0; padding:2px 8px; border-radius:4px;">獨立空間分區</span>`}
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px;">
            ${items.map(p => {
              const realIdx = allPages.indexOf(p);
              const pNum = p.pageNum || `P${realIdx + 1}`;
              const tLbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
              const count = (p.lines || []).length + (p.markers || []).length;
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

  host.querySelectorAll(".btn-back-all-folders").forEach(btn => {
    btn.onclick = () => { filterSpace = "ALL"; viewMode = "FOLDER"; renderOverview(); };
  });
  host.querySelectorAll("[data-open-idx]").forEach(card => {
    card.onclick = () => { activePageIdx = Number(card.dataset.openIdx); renderWorkspace(); };
  });
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
      markers: [],
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
        <button id="btn-back-grid" class="btn-outline btn-sm">‹ 返回空間圖集</button>
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
    memoryPhotoCache.set(page.id, res.imageData);
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
