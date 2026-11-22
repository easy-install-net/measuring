import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "./config/firebase-init.js";
import { loadMasterDict } from "./config/master-dict.js";
import { checkBrowserCompatibility, watchAuth, renderLoginView } from "./core/auth.js";
import { uploadMediaToCloud } from "./core/image-upload.js";
import { MeasureCanvas } from "./modules/measure-canvas.js";
import { renderReportBuilder } from "./modules/report-builder.js";

const PROJ_COL = (COLLECTIONS && COLLECTIONS.PROJECTS) || "measuring_projects";
const MEDIA_COL = (COLLECTIONS && COLLECTIONS.MEDIA) || "measuring_media";
const HIDDEN_STORAGE_KEY = "measuring_hidden_proj_ids";

const root = document.getElementById("app-root");
let masterDict = null;
let currentProject = null;
let activePageIdx = -1;
let viewMode = "FOLDER";
let filterSpace = "ALL";
let filterDocType = "ALL";
let filterReviewOnly = false;
let showHiddenProjects = false;
let folderCoverIndex = {};
let activeCanvasInstance = null;
const memoryPhotoCache = new Map();

const DOC_TYPE_LABELS = {
  plan: "平面圖",
  photo: "拍攝",
  "3d": "立體圖",
  detail: "詳圖",
  render: "效果圖",
  dim: "尺吋圖",
  sketch: "白底草圖"
};

const DOC_TYPE_RANK = { plan: 1, photo: 2, "3d": 3, dim: 4, detail: 5, render: 6, sketch: 7 };

const ZONE_THEMES = [
  { bg: "#FFFBEB", border: "#F59E0B", headerBg: "#FEF3C7", text: "#78350F", badgeBg: "#FDE68A" },
  { bg: "#F0F9FF", border: "#0284C7", headerBg: "#E0F2FE", text: "#0C4A6E", badgeBg: "#BAE6FD" },
  { bg: "#ECFDF5", border: "#059669", headerBg: "#D1FAE5", text: "#064E3B", badgeBg: "#A7F3D0" },
  { bg: "#FFF1F2", border: "#E11D48", headerBg: "#FFE4E6", text: "#881337", badgeBg: "#FECDD3" },
  { bg: "#EEF2FF", border: "#4F46E5", headerBg: "#E0E7FF", text: "#312E81", badgeBg: "#C7D2FE" }
];
const MASTER_ZONE_THEME = { bg: "#FAF5FF", border: "#9333EA", headerBg: "#F3E8FF", text: "#581C87", badgeBg: "#E9D5FF" };
const UNASSIGNED_ZONE_THEME = { bg: "#F8FAFC", border: "#64748B", headerBg: "#E2E8F0", text: "#1E293B", badgeBg: "#CBD5E1" };

function getHiddenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || "[]"));
  } catch (_) {
    return new Set();
  }
}

function saveHiddenIds(setObj) {
  localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(setObj)));
}

function countProjectAnnotations(proj) {
  let total = 0;
  (proj.pages || []).forEach(p => {
    total += (p.lines || []).length + (p.markers || []).length + (p.paths || []).length + (p.stickers || []).length;
  });
  return total;
}

// 防止瀏覽器「上一頁」返回手勢意外跳離網站
window.history.pushState({ measuringGuard: true }, "");
window.addEventListener("popstate", () => {
  window.history.pushState({ measuringGuard: true }, "");
  if (currentProject && activePageIdx >= 0) {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(false);
    saveCurrentProject().finally(() => {
      activePageIdx = -1;
      renderWorkspace();
    });
  } else if (currentProject) {
    if (confirm("確定要離開目前工程返回工程目錄嗎？")) {
      currentProject = null;
      renderProjectList();
    }
  }
});

window.addEventListener("beforeunload", (e) => {
  if (currentProject && activePageIdx >= 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});

checkBrowserCompatibility();

watchAuth(async () => {
  masterDict = await loadMasterDict();
  renderProjectList();
}, () => {
  renderLoginView(root);
});

async function renderProjectList() {
  root.innerHTML = `<div class="card">載入工程清單中...</div>`;
  const snap = await getDocs(collection(db, PROJ_COL));
  const rawProjects = [];
  snap.forEach(d => rawProjects.push({ id: d.id, ...d.data() }));

  // 自動去重：同 legacySourceId 或同名稱的重複副本，只保留標註最多／最新修改的一份
  const dedupMap = new Map();
  rawProjects.forEach(p => {
    const key = p.legacySourceId ? `SRC_${p.legacySourceId}` : `NAME_${(p.name || "").trim()}`;
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, p);
    } else {
      const scoreNew = countProjectAnnotations(p) * 1000000 + (p.updatedAt || 0);
      const scoreOld = countProjectAnnotations(existing) * 1000000 + (existing.updatedAt || 0);
      if (scoreNew > scoreOld) dedupMap.set(key, p);
    }
  });

  const allUniqueProjects = Array.from(dedupMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const hiddenSet = getHiddenIds();
  const visibleProjects = showHiddenProjects
    ? allUniqueProjects
    : allUniqueProjects.filter(p => !hiddenSet.has(p.id));
  const hiddenCount = allUniqueProjects.filter(p => hiddenSet.has(p.id)).length;

  root.innerHTML = `
    <div class="card" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
      <input type="text" id="new-proj-name" placeholder="輸入新工程名稱"
             style="flex:1; min-width:180px; padding:6px 8px; border:1px solid #111827; border-radius:4px; font-size:14px;" />
      <button id="btn-create-proj" class="btn-solid">+ 建立工程</button>
      <button id="btn-db-cleaner" class="btn-outline" style="color:#475569;">🧹 資料庫清理</button>
      ${hiddenCount > 0 ? `
        <button id="btn-toggle-hidden" class="btn-outline btn-sm" style="color:#6B7280;">
          ${showHiddenProjects ? "隱藏已移除項目" : `顯示已移除 (${hiddenCount})`}
        </button>
      ` : ""}
    </div>

    <div id="db-cleaner-box" class="card hidden" style="background:#F8FAFC; border:1.5px solid #475569;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#0F172A;">🧹 後台資料庫清潔（重複副本 / 零碎空工程 / 孤兒底圖）</strong>
        <button id="btn-close-cleaner" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="cleaner-body" style="font-size:12px; color:#334155;">正在掃描雲端資料庫...</div>
    </div>

    <div id="proj-cards">
      ${visibleProjects.map(p => {
        const isHidden = hiddenSet.has(p.id);
        const pendingReviews = (p.pages || []).reduce((acc, pg) => {
          const list = Array.isArray(pg.reviewLogs) ? pg.reviewLogs : [];
          return acc + list.filter(r => r.status === "PENDING").length;
        }, 0);
        return `
          <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:8px; ${isHidden ? "opacity:0.6; background:#F8FAFC;" : ""}">
            <div style="flex:1; cursor:pointer;" data-id="${p.id}">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <strong style="font-size:15px;">${p.name}</strong>
                ${isHidden ? `<span style="font-size:11px; background:#E2E8F0; color:#475569; padding:1px 6px; border-radius:4px;">已從本機移除</span>` : ""}
                ${pendingReviews > 0 ? `<span style="font-size:11px; background:#FEE2E2; color:#DC2626; font-weight:700; padding:1px 6px; border-radius:4px;">🔴 ${pendingReviews}項待改</span>` : ""}
              </div>
              <div style="font-size:12px; color:#6B7280;">共 ${(p.pages || []).length} 頁圖紙</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              ${isHidden
                ? `<button class="btn-outline btn-sm" style="color:#059669; border-color:#6EE7B7;" data-restore-id="${p.id}">↩ 恢復顯示</button>`
                : `<button class="btn-outline btn-sm" style="color:#64748B; border-color:#CBD5E1;" data-hide-id="${p.id}">📦 從本機清單移除</button>`}
              <button class="btn-outline btn-sm" data-id="${p.id}">進入空間圖集 →</button>
            </div>
          </div>
        `;
      }).join("") || `<div class="card" style="color:#6B7280;">目前清單沒有顯示中的工程，請在上方輸入名稱建立。</div>`}
    </div>
  `;

  document.getElementById("btn-create-proj").onclick = async () => {
    const name = document.getElementById("new-proj-name").value.trim();
    if (!name) return;
    const id = "P_" + Date.now();
    const newProj = { id, name, pages: [], updatedAt: Date.now() };
    await setDoc(doc(db, PROJ_COL, id), newProj);
    openProject(newProj);
  };

  const toggleHiddenBtn = document.getElementById("btn-toggle-hidden");
  if (toggleHiddenBtn) {
    toggleHiddenBtn.onclick = () => {
      showHiddenProjects = !showHiddenProjects;
      renderProjectList();
    };
  }

  document.getElementById("btn-db-cleaner").onclick = () => openDatabaseCleaner(rawProjects);
  document.getElementById("btn-close-cleaner").onclick = () => {
    document.getElementById("db-cleaner-box").classList.add("hidden");
  };

  root.querySelectorAll("[data-hide-id]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const s = getHiddenIds();
      s.add(btn.dataset.hideId);
      saveHiddenIds(s);
      renderProjectList();
    };
  });

  root.querySelectorAll("[data-restore-id]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const s = getHiddenIds();
      s.delete(btn.dataset.restoreId);
      saveHiddenIds(s);
      renderProjectList();
    };
  });

  root.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = async () => {
      const found = allUniqueProjects.find(p => p.id === el.dataset.id);
      if (found) await openProjectWithHydration(found);
    };
  });
}

async function openDatabaseCleaner(rawProjects) {
  const box = document.getElementById("db-cleaner-box");
  const body = document.getElementById("cleaner-body");
  box.classList.remove("hidden");
  body.innerHTML = `正在掃描重複工程、零碎空檔與孤兒圖片...`;

  try {
    const mediaSnap = await getDocs(collection(db, MEDIA_COL));
    const allMediaIds = [];
    mediaSnap.forEach(d => allMediaIds.push(d.id));

    // 1. 找出重複工程副本
    const groups = new Map();
    rawProjects.forEach(p => {
      const key = p.legacySourceId ? `SRC_${p.legacySourceId}` : `NAME_${(p.name || "").trim()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });

    const duplicateProjs = [];
    const keptProjs = [];
    groups.forEach(list => {
      list.sort((a, b) => (countProjectAnnotations(b) * 1000000 + (b.updatedAt || 0)) - (countProjectAnnotations(a) * 1000000 + (a.updatedAt || 0)));
      keptProjs.push(list[0]);
      for (let i = 1; i < list.length; i++) duplicateProjs.push(list[i]);
    });

    // 2. 找出零碎空工程（0頁或完全無底圖無標註）
    const emptyProjs = keptProjs.filter(p => {
      const pages = p.pages || [];
      if (pages.length === 0) return true;
      const hasAnyContent = pages.some(pg => pg.mediaRefId || pg.legacyMediaId || (pg.sitePhotoUrl && pg.sitePhotoUrl.length > 20) || (pg.lines || []).length > 0);
      return !hasAnyContent;
    });

    // 3. 找出孤兒底圖（沒有任何保留工程引用的 mediaRefId）
    const validMediaSet = new Set();
    keptProjs.forEach(p => {
      (p.pages || []).forEach(pg => {
        if (pg.mediaRefId) validMediaSet.add(String(pg.mediaRefId));
      });
    });
    const orphanMediaIds = allMediaIds.filter(id => !validMediaSet.has(String(id)));

    if (!duplicateProjs.length && !emptyProjs.length && !orphanMediaIds.length) {
      body.innerHTML = `<div style="color:#059669; font-weight:700; padding:6px 0;">✅ 資料庫非常乾淨，沒有重複工程、零碎空檔或孤兒圖片！</div>`;
      return;
    }

    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;">
        <div>• 重複多餘工程副本：<strong>${duplicateProjs.length}</strong> 筆（將保留標註最多的一份）</div>
        <div>• 零碎無內容空工程：<strong>${emptyProjs.length}</strong> 筆</div>
        <div>• 無人引用的孤兒圖片：<strong>${orphanMediaIds.length}</strong> 張</div>
      </div>
      <button id="btn-exec-clean" class="btn-solid btn-sm" style="background:#DC2626; border-color:#DC2626;">
        🧹 一鍵徹底清理以上零碎與重複資料
      </button>
    `;

    document.getElementById("btn-exec-clean").onclick = async () => {
      if (!confirm(`確定要永久清理這 ${duplicateProjs.length + emptyProjs.length} 筆零碎工程與 ${orphanMediaIds.length} 張孤兒圖片嗎？`)) return;
      const execBtn = document.getElementById("btn-exec-clean");
      execBtn.disabled = true;
      execBtn.textContent = "清理中，請稍候...";

      for (const dp of duplicateProjs) {
        await deleteDoc(doc(db, PROJ_COL, dp.id)).catch(() => {});
      }
      for (const ep of emptyProjs) {
        await deleteDoc(doc(db, PROJ_COL, ep.id)).catch(() => {});
      }
      for (const mid of orphanMediaIds) {
        await deleteDoc(doc(db, MEDIA_COL, mid)).catch(() => {});
      }

      alert("✅ 資料庫清理完成！");
      renderProjectList();
    };
  } catch (err) {
    body.innerHTML = `<span style="color:#DC2626;">掃描失敗：${err.message || err}</span>`;
  }
}

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
    if (p.mediaRefId) {
      try {
        const mDoc = await getDoc(doc(db, MEDIA_COL, String(p.mediaRefId)));
        if (mDoc.exists() && mDoc.data().imageData) {
          p.sitePhotoUrl = mDoc.data().imageData;
          memoryPhotoCache.set(p.id, p.sitePhotoUrl);
          return;
        }
      } catch (_) {}
    }
    if (proj.legacySourceId && p.legacyMediaId) {
      const url = await resolveLegacyMediaPhoto(proj.legacySourceId, p.legacyMediaId);
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

async function resolveLegacyMediaPhoto(projectDocId, mediaDocId) {
  if (!mediaDocId) return "";
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

function openProject(proj) {
  currentProject = proj;
  activePageIdx = -1;
  viewMode = "FOLDER";
  filterSpace = "ALL";
  filterDocType = "ALL";
  filterReviewOnly = false;
  folderCoverIndex = {};
  renderWorkspace();
}

async function saveCurrentProject() {
  if (!currentProject) return;
  currentProject.updatedAt = Date.now();
  const slimPages = (currentProject.pages || []).map(p => {
    if (p.sitePhotoUrl) memoryPhotoCache.set(p.id, p.sitePhotoUrl);
    return { ...p, sitePhotoUrl: "" };
  });
  await setDoc(doc(db, PROJ_COL, currentProject.id), {
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
  activeCanvasInstance = null;
  renderOverview();
}

function renderOverview() {
  const pages = currentProject.pages || [];
  const allSpaces = [...new Set(pages.map(p => p.space || "未標空間"))].sort((a, b) => getSpaceRank(a) - getSpaceRank(b));

  const typeCounts = { ALL: pages.length };
  let totalPendingReviews = 0;
  pages.forEach(p => {
    const lbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
    typeCounts[lbl] = (typeCounts[lbl] || 0) + 1;
    const pLogs = Array.isArray(p.reviewLogs) ? p.reviewLogs : [];
    totalPendingReviews += pLogs.filter(r => r.status === "PENDING").length;
  });

  const filteredPages = pages.filter(p => {
    const spOk = filterSpace === "ALL" || (p.space || "未標空間") === filterSpace;
    const lbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
    const tpOk = filterDocType === "ALL" || lbl === filterDocType;
    const revOk = !filterReviewOnly || (Array.isArray(p.reviewLogs) && p.reviewLogs.some(r => r.status === "PENDING"));
    return spOk && tpOk && revOk;
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
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
      <div style="display:flex; align-items:center; gap:6px;">
        <button id="btn-back-list" class="btn-outline btn-sm">‹ 目錄</button>
        <strong style="font-size:15px;">${currentProject.name}</strong>
      </div>
      <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
        <button id="btn-review-board" class="btn-outline btn-sm" style="border-color:#EF4444; color:#DC2626; font-weight:700;">
          📋 批改總表 (${totalPendingReviews})
        </button>
        <button id="btn-add-space" class="btn-outline btn-sm">+ 空間</button>
        <button id="btn-open-report" class="btn-solid btn-sm">報告與客戶預覽</button>
      </div>
    </div>

    <div id="project-review-board" class="card hidden" style="background:#FFFBFB; border:1.5px solid #FCA5A5; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#991B1B;">📋 本工程審圖批改與跟進總表</strong>
        <button id="btn-close-review-board" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="project-review-list" style="display:flex; flex-direction:column; gap:5px; font-size:12px;"></div>
    </div>

    <div class="card" style="padding:7px 9px; margin-bottom:8px;">
      <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #E5E7EB;">
        <span style="font-size:11px; color:#6B7280; margin-right:2px;">${filteredPages.length}/${pages.length}頁</span>
        <button id="btn-mode-folder" class="chip ${viewMode === "FOLDER" ? "active" : ""}">🗂️ 圖集</button>
        <button id="btn-mode-expanded" class="chip ${viewMode === "EXPANDED" ? "active" : ""}">⊞ 展開</button>
        <button id="btn-filter-review" class="chip ${filterReviewOnly ? "active" : ""}" style="${filterReviewOnly ? "background:#DC2626; border-color:#DC2626; color:#FFF;" : "color:#DC2626;"}">🔴 待改(${totalPendingReviews})</button>
        <span style="color:#D1D5DB;">|</span>
        <button class="chip ${filterSpace === "ALL" ? "active" : ""}" data-fsp="ALL">全部空間</button>
        ${allSpaces.map(sp => {
          const canDrag = sp !== "總圖" && sp !== "未標空間";
          return `
            <button class="chip ${canDrag ? "chip-draggable" : ""} ${filterSpace === sp ? "active" : ""}"
                    data-fsp="${sp}"
                    ${canDrag ? `draggable="true" title="可左右拖拉調整空間排序"` : ""}>${sp}</button>
          `;
        }).join("")}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
        <button class="chip ${filterDocType === "ALL" ? "active" : ""}" data-ftp="ALL">全部(${pages.length})</button>
        ${Object.keys(typeCounts).filter(k => k !== "ALL").map(lbl => `
          <button class="chip ${filterDocType === lbl ? "active" : ""}" data-ftp="${lbl}">${lbl}(${typeCounts[lbl]})</button>
        `).join("")}
      </div>
    </div>

    <div id="dict-picker-box" class="card ${pages.length === 0 ? "" : "hidden"}">
      <div class="section-title">第一步：選擇空間</div>
      <div class="chip-grid" id="picker-spaces" style="margin-bottom:8px;"></div>
      <div class="section-title">第二步：選擇訂造櫃體（選填）</div>
      <div class="chip-grid" id="picker-cabs" style="margin-bottom:10px;"></div>
      <div style="display:flex; gap:6px;">
        <input type="text" id="custom-page-title" placeholder="空間名稱（如：玄關、主人房）" style="flex:1; padding:5px 8px; border:1px solid #111827; border-radius:4px; font-size:13px;" />
        <select id="new-page-doctype" style="padding:5px 6px; border:1px solid #111827; border-radius:4px; font-size:13px;">
          <option value="拍攝">拍攝</option>
          <option value="平面圖">平面圖</option>
          <option value="立體圖">立體圖</option>
          <option value="詳圖">詳圖</option>
          <option value="效果圖">效果圖</option>
          <option value="尺吋圖">尺吋圖</option>
          <option value="白底草圖">白底草圖</option>
        </select>
        <button id="btn-confirm-page" class="btn-solid btn-sm">建立</button>
      </div>
    </div>

    <div id="main-gallery-host"></div>
  `;

  document.getElementById("btn-back-list").onclick = renderProjectList;
  document.getElementById("btn-add-space").onclick = () => document.getElementById("dict-picker-box").classList.toggle("hidden");
  document.getElementById("btn-open-report").onclick = () => renderReportBuilder(root, currentProject, renderWorkspace);

  document.getElementById("btn-mode-folder").onclick = () => { viewMode = "FOLDER"; renderOverview(); };
  document.getElementById("btn-mode-expanded").onclick = () => { viewMode = "EXPANDED"; renderOverview(); };
  document.getElementById("btn-filter-review").onclick = () => {
    filterReviewOnly = !filterReviewOnly;
    if (filterReviewOnly) viewMode = "EXPANDED";
    renderOverview();
  };

  document.getElementById("btn-review-board").onclick = () => {
    const board = document.getElementById("project-review-board");
    board.classList.toggle("hidden");
    if (!board.classList.contains("hidden")) renderProjectReviewList();
  };
  document.getElementById("btn-close-review-board").onclick = () => {
    document.getElementById("project-review-board").classList.add("hidden");
  };

  let draggedSpaceName = null;
  const sortableSpaces = allSpaces.filter(s => s !== "總圖" && s !== "未標空間");

  root.querySelectorAll("[data-fsp]").forEach(btn => {
    const sp = btn.dataset.fsp;
    btn.onclick = () => {
      filterSpace = sp;
      if (filterSpace !== "ALL") viewMode = "EXPANDED";
      renderOverview();
    };

    if (btn.getAttribute("draggable") === "true") {
      btn.ondragstart = (e) => { draggedSpaceName = sp; e.dataTransfer.effectAllowed = "move"; };
      btn.ondragover = (e) => { e.preventDefault(); if (draggedSpaceName && draggedSpaceName !== sp) btn.classList.add("chip-drag-over"); };
      btn.ondragleave = () => btn.classList.remove("chip-drag-over");
      btn.ondrop = async (e) => {
        e.preventDefault();
        btn.classList.remove("chip-drag-over");
        if (!draggedSpaceName || draggedSpaceName === sp) return;
        const nextOrder = [...sortableSpaces];
        const fromIdx = nextOrder.indexOf(draggedSpaceName);
        const toIdx = nextOrder.indexOf(sp);
        if (fromIdx === -1 || toIdx === -1) return;
        nextOrder.splice(fromIdx, 1);
        nextOrder.splice(toIdx, 0, draggedSpaceName);
        currentProject.spaceOrder = nextOrder;
        draggedSpaceName = null;
        renderOverview();
        await saveCurrentProject();
      };
    }
  });

  root.querySelectorAll("[data-ftp]").forEach(btn => {
    btn.onclick = () => { filterDocType = btn.dataset.ftp; renderOverview(); };
  });

  setupDictPicker();

  const galleryHost = document.getElementById("main-gallery-host");
  if (viewMode === "FOLDER" && filterSpace === "ALL" && !filterReviewOnly) {
    renderFolderGrid(galleryHost, sortedGroups, pages);
  } else {
    renderExpandedSections(galleryHost, sortedGroups, pages);
  }
}

function renderProjectReviewList() {
  const host = document.getElementById("project-review-list");
  if (!host) return;
  const rows = [];
  (currentProject.pages || []).forEach((p, pIdx) => {
    (p.reviewLogs || []).forEach((log, lIdx) => {
      rows.push({ p, pIdx, log, lIdx });
    });
  });

  if (!rows.length) {
    host.innerHTML = `<div style="color:#6B7280; padding:6px 0;">尚無審圖批改記錄。進入任意圖紙蓋上審圖印章或點「📝 批改記錄」即可自動建立。</div>`;
    return;
  }

  host.innerHTML = rows.map(({ p, pIdx, log, lIdx }) => {
    const isDone = log.status === "DONE";
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; background:#FFF; border:1px solid ${isDone ? "#BBF7D0" : "#FECACA"}; border-radius:6px;">
        <div style="flex:1; cursor:pointer;" class="rev-jump-page" data-pidx="${pIdx}">
          <div style="font-weight:700; color:#1E293B;">
            ${isDone ? "🟢" : "🔴"} ${p.pageNum || `P${pIdx + 1}`} ${p.space || ""} · ${p.docTypeLabel || ""}
            <span style="font-weight:400; color:#64748B; font-size:11px; margin-left:4px;">${log.time || ""}</span>
          </div>
          <div style="color:${isDone ? "#166534" : "#991B1B"}; margin-top:2px;">${log.note}</div>
        </div>
        <button class="btn-outline btn-sm rev-toggle-status" data-pidx="${pIdx}" data-lidx="${lIdx}"
                style="background:${isDone ? "#DCFCE7" : "#FEE2E2"}; color:${isDone ? "#166534" : "#991B1B"}; border-color:transparent; font-weight:700;">
          ${isDone ? "✅ 已核對通過" : "🔴 待修改 (點此完成)"}
        </button>
      </div>
    `;
  }).join("");

  host.querySelectorAll(".rev-jump-page").forEach(el => {
    el.onclick = () => {
      activePageIdx = Number(el.dataset.pidx);
      renderWorkspace();
    };
  });

  host.querySelectorAll(".rev-toggle-status").forEach(btn => {
    btn.onclick = async () => {
      const p = currentProject.pages[Number(btn.dataset.pidx)];
      const log = p?.reviewLogs?.[Number(btn.dataset.lidx)];
      if (!log) return;
      log.status = log.status === "DONE" ? "PENDING" : "DONE";
      await saveCurrentProject();
      renderProjectReviewList();
    };
  });
}

function renderFolderGrid(host, sortedGroups, allPages) {
  host.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(255px, 1fr)); gap:12px;">
      ${sortedGroups.map(([spaceName, items]) => {
        const activeSubIdx = Math.min(folderCoverIndex[spaceName] || 0, items.length - 1);
        const coverPage = items[activeSubIdx];
        const coverType = coverPage.docTypeLabel || DOC_TYPE_LABELS[coverPage.docType] || "拍攝";
        const previewThumbs = items.slice(0, 4);
        const extraCount = items.length - 4;
        const spacePending = items.reduce((s, pg) => s + (pg.reviewLogs || []).filter(r => r.status === "PENDING").length, 0);

        return `
          <div style="background:#FFF; border:1.5px solid #CBD5E1; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:#F8FAFC; border-bottom:1px solid #E2E8F0;">
              <div style="display:flex; align-items:center; gap:5px;">
                <strong style="font-size:14px; color:#1E293B;">${spaceName}</strong>
                ${spacePending > 0 ? `<span style="font-size:10px; background:#FEE2E2; color:#DC2626; font-weight:700; padding:1px 5px; border-radius:8px;">🔴 ${spacePending}待改</span>` : ""}
              </div>
              <span style="font-size:11px; font-weight:700; color:#475569; background:#E2E8F0; padding:1px 6px; border-radius:10px;">${items.length}張</span>
            </div>

            <div style="padding:3px 10px 0 10px; font-size:11px; color:#64748B;">
              ${coverType}
            </div>

            <div class="folder-main-preview" data-open-page="${allPages.indexOf(coverPage)}"
                 style="height:175px; margin:5px 10px; background:#F1F5F9; border-radius:4px; display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden;">
              ${coverPage.sitePhotoUrl
                ? `<img src="${coverPage.sitePhotoUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                : `<span style="color:#94A3B8; font-size:12px;">尚未上傳圖紙</span>`}
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border-top:1px solid #F1F5F9; background:#FAFAFA;">
              <div style="display:flex; align-items:center; gap:4px;">
                ${previewThumbs.map((tp, tIdx) => `
                  <div class="mini-thumb-btn" data-thumb-space="${spaceName}" data-thumb-idx="${tIdx}"
                       style="width:30px; height:30px; border-radius:3px; overflow:hidden; cursor:pointer; border:${tIdx === activeSubIdx ? "2px solid #2563EB" : "1px solid #CBD5E1"}; background:#FFF;">
                    ${tp.sitePhotoUrl
                      ? `<img src="${tp.sitePhotoUrl}" style="width:100%; height:100%; object-fit:cover;" />`
                      : `<div style="width:100%; height:100%; background:#E2E8F0;"></div>`}
                  </div>
                `).join("")}
                ${extraCount > 0 ? `<span style="font-size:11px; color:#64748B; margin-left:2px;">+${extraCount}</span>` : ""}
              </div>
              <button class="folder-expand-btn" data-expand-space="${spaceName}"
                      style="background:none; border:none; color:#4F46E5; font-size:12px; font-weight:700; cursor:pointer; padding:2px 4px;">
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
    <div style="display:flex; flex-direction:column; gap:16px;">
      ${sortedGroups.map(([spaceName, items], groupIdx) => {
        const theme = spaceName === "總圖"
          ? MASTER_ZONE_THEME
          : (spaceName === "未標空間" ? UNASSIGNED_ZONE_THEME : ZONE_THEMES[groupIdx % ZONE_THEMES.length]);

        return `
          <div style="background:${theme.bg}; border:1.5px solid ${theme.border}; border-radius:8px; overflow:hidden; box-shadow:0 2px 5px rgba(0,0,0,0.04);">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 10px; background:${theme.headerBg}; border-bottom:1.5px solid ${theme.border};">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:14px;">📁</span>
                <strong style="font-size:14px; color:${theme.text};">${spaceName}</strong>
                <span style="background:${theme.badgeBg}; color:${theme.text}; font-weight:700; font-size:11px; padding:1px 6px; border-radius:10px;">
                  ${items.length}頁
                </span>
              </div>
              ${(filterSpace !== "ALL" || filterReviewOnly)
                ? `<button class="btn-outline btn-sm btn-back-all-folders" style="background:#FFF; padding:2px 7px; font-size:11px;">‹ 全部圖集</button>`
                : `<span style="font-size:11px; font-weight:600; color:${theme.text}; opacity:0.85;">空間分區</span>`}
            </div>

            <div style="padding:9px; display:grid; grid-template-columns:repeat(auto-fill, minmax(235px, 1fr)); gap:9px;">
              ${items.map(p => {
                const realIdx = allPages.indexOf(p);
                const pNum = p.pageNum || `P${realIdx + 1}`;
                const tLbl = p.docTypeLabel || DOC_TYPE_LABELS[p.docType] || "拍攝";
                const count = (p.lines || []).length + (p.markers || []).length + (p.paths || []).length;
                const pLogs = Array.isArray(p.reviewLogs) ? p.reviewLogs : [];
                const pendingCnt = pLogs.filter(r => r.status === "PENDING").length;
                const doneCnt = pLogs.filter(r => r.status === "DONE").length;
                const shortDate = (p.date || "").slice(5);
                return `
                  <div class="page-grid-card" data-open-idx="${realIdx}"
                       style="background:#FFF; border:1px solid #CBD5E1; border-radius:5px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column;">
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 7px; border-bottom:1px solid #F1F5F9; font-size:12px; background:#FFFFFF;">
                      <span style="font-weight:700; color:#1D4ED8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${pNum} ${p.space || spaceName} · ${tLbl}
                      </span>
                      <span style="background:#111827; color:#FFF; padding:1px 5px; border-radius:3px; font-size:10px;">度尺</span>
                    </div>
                    <div style="position:relative; height:150px; background:#F8FAFC; display:flex; align-items:center; justify-content:center;">
                      ${p.sitePhotoUrl
                        ? `<img src="${p.sitePhotoUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                        : `<span style="color:#94A3B8; font-size:12px;">尚未上傳圖紙</span>`}
                      <div style="position:absolute; top:5px; right:5px; display:flex; flex-direction:column; gap:3px; align-items:flex-end;">
                        ${pendingCnt > 0
                          ? `<span style="background:#DC2626; color:#FFF; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">🔴 ${pendingCnt}項待改</span>`
                          : (doneCnt > 0 ? `<span style="background:#059669; color:#FFF; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">🟢 審圖通過</span>` : "")}
                        ${count > 0
                          ? `<span style="background:#1E293B; color:#FFF; font-size:10px; padding:1px 5px; border-radius:3px;">📐 ${count}標註</span>`
                          : ""}
                      </div>
                      ${(shortDate || p.author)
                        ? `<span style="position:absolute; bottom:5px; right:5px; background:rgba(255,255,255,0.92); color:#475569; font-size:10px; padding:1px 5px; border-radius:3px; border:1px solid #CBD5E1;">${shortDate} ${p.author || ""}</span>`
                        : ""}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  host.querySelectorAll(".btn-back-all-folders").forEach(btn => {
    btn.onclick = () => { filterSpace = "ALL"; filterReviewOnly = false; viewMode = "FOLDER"; renderOverview(); };
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
      sitePhotoUrl: docTypeVal === "白底草圖" ? createBlankWhiteDataUrl() : "",
      designPhotoUrl: "",
      lines: [],
      markers: [],
      paths: [],
      walls: [],
      pins: [],
      stickers: [],
      reviewLogs: []
    });
    activePageIdx = currentProject.pages.length - 1;
    await saveCurrentProject();
    renderWorkspace();
  };
}

function createBlankWhiteDataUrl() {
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 1200;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.92);
}

function renderSinglePageEditor(page) {
  const totalPages = currentProject.pages.length;
  const pageTitleText = `${page.pageNum || `P${activePageIdx + 1}`} ${page.space || ""} · ${page.docTypeLabel || ""}`.trim();
  if (!Array.isArray(page.reviewLogs)) page.reviewLogs = [];

  root.innerHTML = `
    <div id="fullscreen-editor-shell" style="position:fixed; inset:0; width:100vw; height:100vh; background:#0F172A; display:flex; flex-direction:column; z-index:900; overflow:hidden;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 10px; background:#111827; border-bottom:1px solid #374151; flex-wrap:wrap; gap:6px; z-index:20;">
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-back-grid" style="background:#FACC15; color:#111827; border:none; border-radius:6px; padding:4px 11px; font-size:13px; font-weight:800; cursor:pointer; box-shadow:0 2px 6px rgba(250,204,21,0.35);">
            ‹ 返回圖集
          </button>
          <strong style="font-size:14px; color:#F9FAFB;">${pageTitleText}</strong>
          <span style="font-size:12px; color:#9CA3AF;">(${activePageIdx + 1}/${totalPages})</span>
          <button id="btn-toggle-white-bg" title="切換白底批改草圖畫布"
                  style="background:#F8FAFC; color:#0F172A; border:1px solid #CBD5E1; border-radius:6px; padding:3px 9px; font-size:12px; font-weight:800; cursor:pointer;">
            📄 白底
          </button>
        </div>

        <div style="display:flex; align-items:center; gap:6px;">
          <button id="btn-page-review-drawer" style="background:#7F1D1D; color:#FECACA; border:1px solid #EF4444; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:700; cursor:pointer;">
            📝 批改記錄 (${page.reviewLogs.length})
          </button>
          <button id="btn-manual-save" style="background:#10B981; color:#FFF; border:none; border-radius:6px; padding:4px 11px; font-size:12px; font-weight:800; cursor:pointer;">
            💾 儲存
          </button>
          <label style="background:#374151; color:#F9FAFB; border:1px solid #4B5563; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:700; cursor:pointer;">
            📷 換底圖
            <input type="file" id="up-site-photo" accept="image/*" class="hidden" />
          </label>
        </div>
      </div>

      <!-- 單頁批改記錄懸浮抽屜 -->
      <div id="page-review-drawer" class="hidden" style="position:absolute; right:12px; top:44px; width:310px; max-height:70vh; overflow-y:auto; background:#1F2937; color:#F9FAFB; border:1px solid #4B5563; border-radius:10px; padding:10px; box-shadow:0 12px 28px rgba(0,0,0,0.55); z-index:40; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #374151; padding-bottom:5px;">
          <strong style="font-size:12px; color:#FCA5A5;">📝 本頁審圖批改記錄</strong>
          <button id="btn-close-page-rev" style="background:none; border:none; color:#9CA3AF; font-size:14px; cursor:pointer;">✕</button>
        </div>
        <div style="display:flex; gap:4px;">
          <input type="text" id="new-rev-note" placeholder="輸入批改要求（如：收口改35mm）"
                 style="flex:1; padding:5px 7px; border-radius:5px; border:1px solid #4B5563; background:#111827; color:#FFF; font-size:12px;" />
          <button id="btn-add-rev-note" style="background:#EF4444; color:#FFF; border:none; border-radius:5px; padding:0 9px; font-size:12px; font-weight:700; cursor:pointer;">新增</button>
        </div>
        <div id="page-rev-items" style="display:flex; flex-direction:column; gap:5px; font-size:12px;"></div>
      </div>

      <div id="sub-module-host" style="flex:1; width:100%; height:100%; position:relative; overflow:hidden;"></div>
    </div>
  `;

  const renderPageRevItems = () => {
    const listEl = document.getElementById("page-rev-items");
    const badgeBtn = document.getElementById("btn-page-review-drawer");
    if (badgeBtn) badgeBtn.textContent = `📝 批改記錄 (${page.reviewLogs.length})`;
    if (!listEl) return;
    if (!page.reviewLogs.length) {
      listEl.innerHTML = `<div style="color:#9CA3AF; font-size:11px;">尚無批改記錄，可在上方輸入或直接蓋審圖印章。</div>`;
      return;
    }
    listEl.innerHTML = page.reviewLogs.map((r, i) => {
      const isDone = r.status === "DONE";
      return `
        <div style="background:#111827; border:1px solid ${isDone ? "#059669" : "#DC2626"}; border-radius:6px; padding:6px 8px; display:flex; justify-content:space-between; align-items:center; gap:6px;">
          <div style="flex:1;">
            <div style="font-size:10px; color:#9CA3AF;">${r.time || ""}</div>
            <div style="color:${isDone ? "#6EE7B7" : "#FCA5A5"}; font-weight:700;">${r.note}</div>
          </div>
          <button class="page-rev-toggle" data-ridx="${i}" style="background:${isDone ? "#065F46" : "#991B1B"}; color:#FFF; border:none; border-radius:4px; padding:3px 6px; font-size:10px; cursor:pointer;">
            ${isDone ? "🟢 已通過" : "🔴 待改"}
          </button>
          <button class="page-rev-del" data-ridx="${i}" style="background:none; border:none; color:#9CA3AF; font-size:12px; cursor:pointer;">✕</button>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".page-rev-toggle").forEach(b => {
      b.onclick = async () => {
        const item = page.reviewLogs[Number(b.dataset.ridx)];
        if (item) item.status = item.status === "DONE" ? "PENDING" : "DONE";
        renderPageRevItems();
        await saveCurrentProject();
      };
    });
    listEl.querySelectorAll(".page-rev-del").forEach(b => {
      b.onclick = async () => {
        page.reviewLogs.splice(Number(b.dataset.ridx), 1);
        renderPageRevItems();
        await saveCurrentProject();
      };
    });
  };

  renderPageRevItems();

  document.getElementById("btn-page-review-drawer").onclick = () => {
    document.getElementById("page-review-drawer").classList.toggle("hidden");
  };
  document.getElementById("btn-close-page-rev").onclick = () => {
    document.getElementById("page-review-drawer").classList.add("hidden");
  };
  document.getElementById("btn-add-rev-note").onclick = async () => {
    const inp = document.getElementById("new-rev-note");
    const txt = inp.value.trim();
    if (!txt) return;
    const now = new Date();
    const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    page.reviewLogs.unshift({ time: tStr, note: txt, status: "PENDING" });
    inp.value = "";
    renderPageRevItems();
    await saveCurrentProject();
  };

  const saveAndRun = async (fn) => {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(false);
    await saveCurrentProject();
    fn();
  };

  document.getElementById("btn-back-grid").onclick = () => {
    saveAndRun(() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      activePageIdx = -1;
      renderWorkspace();
    });
  };

  const saveBtn = document.getElementById("btn-manual-save");
  saveBtn.onclick = async () => {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(true);
    saveBtn.textContent = "儲存中...";
    await saveCurrentProject();
    saveBtn.textContent = "✅ 已儲存";
    setTimeout(() => { saveBtn.textContent = "💾 儲存"; }, 1400);
  };

  // 白底切換按鈕
  const whiteBtn = document.getElementById("btn-toggle-white-bg");
  whiteBtn.onclick = () => {
    if (!activeCanvasInstance) {
      page.sitePhotoUrl = createBlankWhiteDataUrl();
      showMeasure();
      return;
    }
    const isWhite = activeCanvasInstance.toggleWhiteBackground();
    whiteBtn.style.background = isWhite ? "#FACC15" : "#F8FAFC";
    whiteBtn.textContent = isWhite ? "🖼️ 還原底圖" : "📄 白底";
  };

  const host = document.getElementById("sub-module-host");

  const showMeasure = () => {
    if (!page.sitePhotoUrl) {
      host.innerHTML = `<div style="color:#E5E7EB; text-align:center; padding:40px; font-size:15px;">請先點擊右上角「📷 換底圖」拍照，或按上方「📄 白底」直接開白底草圖。</div>`;
      return;
    }
    activeCanvasInstance = new MeasureCanvas(
      host,
      page.sitePhotoUrl,
      {
        lines: page.lines || [],
        markers: page.markers || [],
        paths: page.paths || [],
        walls: page.walls || [],
        pins: page.pins || [],
        stickers: page.stickers || []
      },
      masterDict.rulerColors,
      async (updated) => {
        page.lines = updated.lines || [];
        page.markers = updated.markers || [];
        if (updated.paths) page.paths = updated.paths;
        if (updated.walls) page.walls = updated.walls;
        if (updated.stickers) page.stickers = updated.stickers;
        if (updated.mergedBaseUrl) {
          page.sitePhotoUrl = updated.mergedBaseUrl;
          memoryPhotoCache.set(page.id, updated.mergedBaseUrl);
        }
        if (updated.newReviewNote) {
          const now = new Date();
          const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          page.reviewLogs.unshift({ time: tStr, note: updated.newReviewNote, status: "PENDING" });
          renderPageRevItems();
        }
        await saveCurrentProject();
      },
      {
        pageTitle: pageTitleText,
        hasPrev: activePageIdx > 0,
        hasNext: activePageIdx < totalPages - 1,
        onPrev: () => {
          if (activePageIdx > 0) saveAndRun(() => { activePageIdx--; renderWorkspace(); });
        },
        onNext: () => {
          if (activePageIdx < totalPages - 1) saveAndRun(() => { activePageIdx++; renderWorkspace(); });
        }
      }
    );
  };

  document.getElementById("up-site-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div style="color:#E5E7EB; text-align:center; padding:40px;">正在壓縮並同步底圖至雲端...</div>`;
    const res = await uploadMediaToCloud(currentProject.id, page.id, file);
    page.sitePhotoUrl = res.imageData;
    memoryPhotoCache.set(page.id, res.imageData);
    await saveCurrentProject();
    showMeasure();
  };

  showMeasure();
}
