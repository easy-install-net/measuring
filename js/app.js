import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "./config/firebase-init.js";
import { loadMasterDict } from "./config/master-dict.js";
import { checkBrowserCompatibility, watchAuth, renderLoginView } from "./core/auth.js";
import { uploadMediaToCloud } from "./core/image-upload.js";
import { MeasureCanvas, DEFAULT_CHECKLIST_PHRASES } from "./modules/measure-canvas.js";
import { renderReportBuilder } from "./modules/report-builder.js";

const PROJ_COL = (COLLECTIONS && COLLECTIONS.PROJECTS) || "measuring_projects";
const MEDIA_COL = (COLLECTIONS && COLLECTIONS.MEDIA) || "measuring_media";
const SETTINGS_COL = "measuring_settings";
const PHRASE_DOC_ID = "custom_review_phrases_v1";
const LOCAL_ACTIVE_KEY = "measuring_local_active_projects_v2";
const HIDDEN_STORAGE_KEY = "measuring_hidden_proj_ids";

const root = document.getElementById("app-root");
let masterDict = null;
let currentProject = null;
let activePageIdx = -1;
let compareSpaceName = null; // ⚖️ 左右對照模式當前空間
let filterSpace = "ALL";
let filterCategory = "ALL"; // ALL | 度尺圖 | 平面圖 | 繪圖 | 效果圖
let filterStatus = "ALL";   // ALL | NEED_FIX | SITE_CHECK | NEED_INFO | OK
let showArchivedInSummon = false;
let summonSearchText = "";
let cachedCloudActiveList = null;
let cachedCloudArchivedList = null;
let openContactProjId = null;
let folderCoverIndex = {};
let activeCanvasInstance = null;
let customPhraseBank = [...DEFAULT_CHECKLIST_PHRASES];
const memoryPhotoCache = new Map();

// 4 大核心分類對應（自動無痛兼容舊資料的 docType / docTypeLabel）
const CORE_CATEGORIES = ["度尺圖", "平面圖", "繪圖", "效果圖"];

function normalizePageCategory(p) {
  const raw = String(p?.docTypeLabel || p?.docType || "").trim();
  if (raw === "平面圖" || raw === "plan") return "平面圖";
  if (raw === "效果圖" || raw === "render") return "效果圖";
  if (raw === "繪圖" || raw === "立體圖" || raw === "詳圖" || raw === "3d" || raw === "detail") return "繪圖";
  return "度尺圖"; // 拍攝、尺吋圖、白底草圖、photo、dim、sketch 統一歸入「度尺圖」
}

const CAT_RANK = { "平面圖": 1, "度尺圖": 2, "繪圖": 3, "效果圖": 4 };

// 4 種審圖批改狀態
const REVIEW_STATUS_META = {
  NEED_FIX:   { label: "❌ 需修改",   bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5", badgeBg: "#DC2626", badgeText: "#FFFFFF" },
  SITE_CHECK: { label: "⚠️ 現場核對", bg: "#FEF3C7", text: "#92400E", border: "#FCD34D", badgeBg: "#D97706", badgeText: "#FFFFFF" },
  NEED_INFO:  { label: "📌 待補資料", bg: "#DBEAFE", text: "#1E40AF", border: "#93C5FD", badgeBg: "#2563EB", badgeText: "#FFFFFF" },
  OK:         { label: "✅ 確認無誤", bg: "#DCFCE7", text: "#166534", border: "#86EFAC", badgeBg: "#059669", badgeText: "#FFFFFF" }
};
const STATUS_CYCLE_ORDER = ["NEED_FIX", "SITE_CHECK", "NEED_INFO", "OK"];

function normalizeReviewStatus(raw) {
  if (raw === "OK" || raw === "DONE") return "OK";
  if (raw === "SITE_CHECK") return "SITE_CHECK";
  if (raw === "NEED_INFO") return "NEED_INFO";
  return "NEED_FIX";
}

function applyBrandTitle() {
  document.title = "度尺批改";
  document.querySelectorAll("header, nav, .navbar, .topbar, h1, a, span, strong, div").forEach(el => {
    if (el.children.length === 0 && el.textContent && el.textContent.trim() === "MEASURING") {
      el.textContent = "度尺批改";
    }
  });
}
applyBrandTitle();

function cleanProjectTitle(name) {
  return String(name || "")
    .replace(/\s*\(\d{5,8}\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function getLocalProjects() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_ACTIVE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

function saveLocalProjects(list) {
  const slimList = (list || []).map(p => ({
    ...p,
    pages: (p.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }))
  }));
  localStorage.setItem(LOCAL_ACTIVE_KEY, JSON.stringify(slimList));
}

function upsertLocalProject(proj) {
  if (!proj || !proj.id) return;
  const list = getLocalProjects();
  const cleanSlim = {
    ...proj,
    pages: (proj.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }))
  };
  const idx = list.findIndex(x => x.id === proj.id);
  if (proj.archived === true) {
    if (idx >= 0) list.splice(idx, 1);
  } else if (idx >= 0) {
    list[idx] = cleanSlim;
  } else {
    list.unshift(cleanSlim);
  }
  saveLocalProjects(list);
}

function removeLocalProjectById(pid) {
  saveLocalProjects(getLocalProjects().filter(x => x.id !== pid));
}

function countProjectAnnotations(proj) {
  let total = 0;
  (proj.pages || []).forEach(p => {
    total += (p.lines || []).length + (p.markers || []).length + (p.paths || []).length + (p.arrows || []).length + (p.stickers || []).length;
  });
  return total;
}

function formatUpdatedTime(ts) {
  if (!ts) return "未記錄時間";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "未記錄時間";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function parseMapQueryFromTitle(title) {
  const cleaned = cleanProjectTitle(title)
    .replace(/傢俬圖|尺吋圖|平面圖|度尺/g, "")
    .trim();
  return encodeURIComponent(`香港 ${cleaned}`);
}

function formatWhatsAppUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const hkPhone = digits.length === 8 ? `852${digits}` : digits;
  return `https://wa.me/${hkPhone}`;
}

function dedupProjects(rawProjects) {
  const dedupMap = new Map();
  rawProjects.forEach(p => {
    const key = p.legacySourceId ? `SRC_${p.legacySourceId}` : `NAME_${cleanProjectTitle(p.name)}`;
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, p);
    } else {
      const scoreNew = countProjectAnnotations(p) * 1000000 + (p.updatedAt || 0);
      const scoreOld = countProjectAnnotations(existing) * 1000000 + (existing.updatedAt || 0);
      if (scoreNew > scoreOld) dedupMap.set(key, p);
    }
  });
  return Array.from(dedupMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function loadCustomPhraseBank() {
  try {
    const snap = await getDoc(doc(db, SETTINGS_COL, PHRASE_DOC_ID));
    if (snap.exists() && Array.isArray(snap.data().phrases) && snap.data().phrases.length > 0) {
      customPhraseBank = snap.data().phrases;
    }
  } catch (_) {}
}

async function saveCustomPhraseBank() {
  try {
    await setDoc(doc(db, SETTINGS_COL, PHRASE_DOC_ID), {
      phrases: customPhraseBank,
      updatedAt: Date.now()
    });
  } catch (_) {}
}

window.history.pushState({ measuringGuard: true }, "");
window.addEventListener("popstate", () => {
  window.history.pushState({ measuringGuard: true }, "");
  if (compareSpaceName) {
    compareSpaceName = null;
    renderWorkspace();
  } else if (currentProject && activePageIdx >= 0) {
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
  applyBrandTitle();
  masterDict = await loadMasterDict();
  loadCustomPhraseBank();
  renderProjectList();
}, () => {
  applyBrandTitle();
  renderLoginView(root);
});

async function fetchActiveCloudProjects(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(cachedCloudActiveList)) {
    return cachedCloudActiveList;
  }
  const snap = await getDocs(collection(db, PROJ_COL));
  const raw = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.archived !== true) {
      raw.push({ id: d.id, ...data });
    }
  });
  cachedCloudActiveList = dedupProjects(raw);
  return cachedCloudActiveList;
}

async function fetchArchivedCloudProjects(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(cachedCloudArchivedList)) {
    return cachedCloudArchivedList;
  }
  const qArch = query(collection(db, PROJ_COL), where("archived", "==", true));
  const snap = await getDocs(qArch);
  const raw = [];
  snap.forEach(d => raw.push({ id: d.id, ...d.data() }));
  cachedCloudArchivedList = dedupProjects(raw);
  return cachedCloudArchivedList;
}

// ==========================================
// 1. 首頁工程目錄（真・零數據耗損加載）
// ==========================================
async function renderProjectList(options = {}) {
  applyBrandTitle();
  const { openSummon = false, forceFetchCloud = false } = options;

  let localList = getLocalProjects().filter(p => p.archived !== true);
  const hiddenSet = getHiddenIds();

  if (localList.length === 0 && !localStorage.getItem(LOCAL_ACTIVE_KEY)) {
    root.innerHTML = `<div class="card">首次初始化進行中工程清單...</div>`;
    const activeFromCloud = await fetchActiveCloudProjects(false);
    localList = activeFromCloud.filter(p => !hiddenSet.has(p.id));
    saveLocalProjects(localList);
  }

  const visibleProjects = localList
    .filter(p => !hiddenSet.has(p.id) && p.archived !== true)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  root.innerHTML = `
    <div class="card" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
      <input type="text" id="new-proj-name" placeholder="輸入新工程名稱"
             style="flex:1; min-width:170px; padding:6px 8px; border:1px solid #111827; border-radius:4px; font-size:14px;" />
      <button id="btn-create-proj" class="btn-solid">+ 建立工程</button>
      <button id="btn-summon-proj" class="btn-outline" style="color:#1D4ED8; border-color:#93C5FD; font-weight:800; background:#EFF6FF;">
        📣 召喚工程
      </button>
      <button id="btn-db-cleaner" class="btn-outline" style="color:#475569;">🧹 資料庫清理</button>
    </div>

    <div id="summon-cloud-box" class="card ${openSummon ? "" : "hidden"}" style="background:#EFF6FF; border:1.5px solid #3B82F6;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
        <strong style="font-size:13px; color:#1E3A8A;">📣 召喚工程（雲端未完工清單 · 按需查詢省數據）</strong>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <label style="font-size:11px; color:#334155; display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" id="chk-show-archived-summon" ${showArchivedInSummon ? "checked" : ""} />
            查看已完工封存
          </label>
          <button id="btn-refresh-summon" class="btn-outline btn-sm" style="color:#1D4ED8; border-color:#93C5FD;">🔄 刷新雲端</button>
          <button id="btn-close-summon-box" class="btn-outline btn-sm">關閉</button>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <input type="text" id="summon-filter-input" value="${summonSearchText}" placeholder="🔍 輸入屋苑或關鍵字篩選..."
               style="width:100%; box-sizing:border-box; padding:6px 9px; border:1px solid #93C5FD; border-radius:6px; font-size:13px; background:#FFF;" />
      </div>
      <div id="summon-list-body" style="display:flex; flex-direction:column; gap:5px; max-height:340px; overflow-y:auto;"></div>
    </div>

    <div id="db-cleaner-box" class="card hidden" style="background:#F8FAFC; border:1.5px solid #475569;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#0F172A;">🧹 後台資料庫清潔</strong>
        <button id="btn-close-cleaner" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="cleaner-body" style="font-size:12px; color:#334155;">正在掃描雲端資料庫...</div>
    </div>

    <div id="proj-cards">
      ${visibleProjects.map(p => {
        const displayTitle = cleanProjectTitle(p.name);
        const contacts = Array.isArray(p.contacts) ? p.contacts : [];
        let fixCnt = 0;
        let checkCnt = 0;
        (p.pages || []).forEach(pg => {
          (pg.reviewLogs || []).forEach(r => {
            const st = normalizeReviewStatus(r.status);
            if (st === "NEED_FIX") fixCnt++;
            else if (st === "SITE_CHECK" || st === "NEED_INFO") checkCnt++;
          });
        });
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${parseMapQueryFromTitle(displayTitle)}`;
        const isContactOpen = openContactProjId === p.id;

        return `
          <div class="card" style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="flex:1; min-width:200px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <strong style="font-size:15px; cursor:pointer;" data-id="${p.id}">${displayTitle}</strong>
                  <button class="btn-contact-toggle" data-contact-pid="${p.id}" title="隨手臨時聯絡記錄"
                          style="background:${contacts.length > 0 ? "#FEF3C7" : "#F1F5F9"}; color:${contacts.length > 0 ? "#92400E" : "#475569"}; border:1px solid ${contacts.length > 0 ? "#F59E0B" : "#CBD5E1"}; border-radius:999px; padding:1px 7px; font-size:12px; font-weight:700; cursor:pointer;">
                    👤${contacts.length > 0 ? ` ${contacts.length}` : ""}
                  </button>
                  <button class="btn-rename-proj" data-rename-pid="${p.id}" title="修改工程名稱"
                          style="background:none; border:1px solid #E2E8F0; border-radius:5px; padding:1px 5px; font-size:11px; color:#64748B; cursor:pointer;">
                    ✏️
                  </button>
                  ${fixCnt > 0 ? `<span style="font-size:11px; background:#FEE2E2; color:#991B1B; font-weight:700; padding:1px 6px; border-radius:4px;">❌ ${fixCnt}需修改</span>` : ""}
                  ${checkCnt > 0 ? `<span style="font-size:11px; background:#FEF3C7; color:#92400E; font-weight:700; padding:1px 6px; border-radius:4px;">⚠️ ${checkCnt}待核/補</span>` : ""}
                </div>
                <div style="font-size:12px; color:#6B7280; margin-top:2px; cursor:pointer;" data-id="${p.id}">
                  共 ${(p.pages || []).length} 頁圖紙 · 更新於 ${formatUpdatedTime(p.updatedAt)}
                </div>
              </div>

              <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline btn-sm"
                   style="text-decoration:none; color:#0284C7; border-color:#BAE6FD; font-weight:700;">🗺️ Map</a>
                <button class="btn-outline btn-sm" style="color:#059669; border-color:#A7F3D0; font-weight:700;"
                        data-archive-id="${p.id}">✅ 完工封存</button>
                <button class="btn-outline btn-sm" style="color:#64748B; border-color:#CBD5E1;"
                        data-hide-id="${p.id}">📦 移除</button>
                <button class="btn-solid btn-sm" data-id="${p.id}">進入空間圖集 →</button>
              </div>
            </div>

            ${isContactOpen ? renderContactDrawerHtml(p) : ""}
          </div>
        `;
      }).join("") || `
        <div class="card" style="color:#475569; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span>目前首頁沒有進行中的工程（零數據待機中）。</span>
          <button id="btn-empty-summon" class="btn-solid btn-sm">📣 立即召喚工程</button>
        </div>
      `}
    </div>
  `;

  const emptySummonBtn = document.getElementById("btn-empty-summon");
  if (emptySummonBtn) {
    emptySummonBtn.onclick = () => {
      document.getElementById("summon-cloud-box").classList.remove("hidden");
      populateSummonList(false);
    };
  }

  document.getElementById("btn-create-proj").onclick = async () => {
    const name = cleanProjectTitle(document.getElementById("new-proj-name").value.trim());
    if (!name) return;
    const id = "P_" + Date.now();
    const newProj = { id, name, pages: [], contacts: [], archived: false, updatedAt: Date.now() };
    await setDoc(doc(db, PROJ_COL, id), newProj);
    upsertLocalProject(newProj);
    if (Array.isArray(cachedCloudActiveList)) cachedCloudActiveList.unshift(newProj);
    openProject(newProj);
  };

  document.getElementById("btn-summon-proj").onclick = () => {
    const box = document.getElementById("summon-cloud-box");
    const willOpen = box.classList.contains("hidden");
    box.classList.toggle("hidden");
    if (willOpen) populateSummonList(false);
  };
  document.getElementById("btn-refresh-summon").onclick = () => populateSummonList(true);
  document.getElementById("btn-close-summon-box").onclick = () => document.getElementById("summon-cloud-box").classList.add("hidden");
  document.getElementById("chk-show-archived-summon").onchange = (e) => { showArchivedInSummon = e.target.checked; populateSummonList(false); };
  document.getElementById("summon-filter-input").oninput = (e) => { summonSearchText = e.target.value; populateSummonList(false); };
  if (openSummon) populateSummonList(forceFetchCloud);

  document.getElementById("btn-db-cleaner").onclick = () => openDatabaseCleaner();
  document.getElementById("btn-close-cleaner").onclick = () => document.getElementById("db-cleaner-box").classList.add("hidden");

  root.querySelectorAll(".btn-contact-toggle").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pid = btn.dataset.contactPid;
      openContactProjId = openContactProjId === pid ? null : pid;
      renderProjectList();
    };
  });
  bindContactEvents(visibleProjects);

  root.querySelectorAll(".btn-rename-proj").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const target = visibleProjects.find(p => p.id === btn.dataset.renamePid);
      if (!target) return;
      const nextName = prompt("修改工程名稱：", cleanProjectTitle(target.name));
      if (nextName === null) return;
      const trimmed = cleanProjectTitle(nextName);
      if (!trimmed || trimmed === target.name) return;
      await renameProjectEverywhere(target, trimmed);
      renderProjectList();
    };
  });

  root.querySelectorAll("[data-archive-id]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const target = visibleProjects.find(p => p.id === btn.dataset.archiveId);
      if (!target) return;
      const cleanTitle = cleanProjectTitle(target.name);
      if (!confirm(`確定將「${cleanTitle}」標記為完工封存嗎？`)) return;
      target.name = cleanTitle;
      target.archived = true;
      target.archivedAt = Date.now();
      const slimPages = (target.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
      await setDoc(doc(db, PROJ_COL, target.id), { ...target, pages: slimPages });
      removeLocalProjectById(target.id);
      if (Array.isArray(cachedCloudActiveList)) cachedCloudActiveList = cachedCloudActiveList.filter(x => x.id !== target.id);
      if (Array.isArray(cachedCloudArchivedList)) cachedCloudArchivedList.unshift(target);
      renderProjectList();
    };
  });

  root.querySelectorAll("[data-hide-id]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pid = btn.dataset.hideId;
      const s = getHiddenIds();
      s.add(pid);
      saveHiddenIds(s);
      removeLocalProjectById(pid);
      renderProjectList();
    };
  });

  root.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = async () => {
      const found = visibleProjects.find(p => p.id === el.dataset.id);
      if (found) await openProjectLightweight(found);
    };
  });
}

// 👤 隨手臨時聯絡記錄（自由輸入便條）
function renderContactDrawerHtml(proj) {
  const contacts = Array.isArray(proj.contacts) ? proj.contacts : [];
  return `
    <div style="background:#FFFBEB; border:1px solid #FCD34D; border-radius:6px; padding:7px 9px; display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="font-size:12px; color:#92400E;">👤 隨手臨時聯絡記錄（自由打字便條）</strong>
        <button class="btn-contact-close btn-outline btn-sm" style="padding:1px 6px; font-size:11px;">收起</button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:5px; align-items:center;">
        <input type="text" id="ct-name-${proj.id}" placeholder="自由輸入（如：業主陳生 / 木工阿明 / 鎖匙放管理處）"
               style="flex:2; min-width:170px; padding:5px 7px; border:1px solid #D97706; border-radius:4px; font-size:12px; background:#FFF;" />
        <input type="tel" id="ct-phone-${proj.id}" placeholder="電話（選填）"
               style="flex:1; min-width:105px; padding:5px 7px; border:1px solid #D97706; border-radius:4px; font-size:12px; background:#FFF;" />
        <button class="btn-solid btn-sm btn-ct-add" data-pid="${proj.id}" style="background:#D97706; border-color:#D97706;">+ 記低</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${contacts.map((c, idx) => {
          const waUrl = formatWhatsAppUrl(c.phone);
          const displayLine = [c.name, c.note].filter(Boolean).join(" · ");
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; background:#FFF; border:1px solid #FDE68A; border-radius:5px; padding:4px 8px; flex-wrap:wrap;">
              <div style="font-size:12px; color:#1E293B;">
                <strong>${displayLine || "臨時記錄"}</strong>
                ${c.phone ? `<span style="color:#0284C7; margin-left:6px; font-weight:600;">${c.phone}</span>` : ""}
              </div>
              <div style="display:flex; gap:5px; align-items:center;">
                ${c.phone ? `<a href="tel:${c.phone}" class="btn-outline btn-sm" style="text-decoration:none; padding:1px 6px; font-size:11px; color:#059669; border-color:#6EE7B7;">📞 撥打</a>` : ""}
                ${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline btn-sm" style="text-decoration:none; padding:1px 6px; font-size:11px; color:#16A34A; border-color:#86EFAC;">💬 WhatsApp</a>` : ""}
                <button class="btn-ct-del" data-pid="${proj.id}" data-cidx="${idx}"
                        style="background:none; border:none; color:#94A3B8; font-size:12px; cursor:pointer; padding:0 4px;">✕</button>
              </div>
            </div>
          `;
        }).join("") || `<div style="font-size:11px; color:#92400E;">尚無臨時記錄，隨時在上方輸入。</div>`}
      </div>
    </div>
  `;
}

function bindContactEvents(projectListRef) {
  root.querySelectorAll(".btn-contact-close").forEach(btn => {
    btn.onclick = () => { openContactProjId = null; renderProjectList(); };
  });
  root.querySelectorAll(".btn-ct-add").forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const target = projectListRef.find(p => p.id === pid);
      if (!target) return;
      const nameVal = (document.getElementById(`ct-name-${pid}`)?.value || "").trim();
      const phoneVal = (document.getElementById(`ct-phone-${pid}`)?.value || "").trim();
      if (!nameVal && !phoneVal) return;
      if (!Array.isArray(target.contacts)) target.contacts = [];
      target.contacts.push({ name: nameVal || "聯絡記錄", phone: phoneVal });
      target.updatedAt = Date.now();
      const slimPages = (target.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
      await setDoc(doc(db, PROJ_COL, target.id), { ...target, pages: slimPages });
      upsertLocalProject(target);
      renderProjectList();
    };
  });
  root.querySelectorAll(".btn-ct-del").forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const target = projectListRef.find(p => p.id === pid);
      if (!target || !Array.isArray(target.contacts)) return;
      target.contacts.splice(Number(btn.dataset.cidx), 1);
      target.updatedAt = Date.now();
      const slimPages = (target.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
      await setDoc(doc(db, PROJ_COL, target.id), { ...target, pages: slimPages });
      upsertLocalProject(target);
      renderProjectList();
    };
  });
}

async function renameProjectEverywhere(proj, newCleanName) {
  proj.name = newCleanName;
  proj.updatedAt = Date.now();
  const slimPages = (proj.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
  await setDoc(doc(db, PROJ_COL, proj.id), { ...proj, pages: slimPages });
  upsertLocalProject(proj);
  if (Array.isArray(cachedCloudActiveList)) {
    const found = cachedCloudActiveList.find(x => x.id === proj.id);
    if (found) found.name = newCleanName;
  }
}

async function populateSummonList(forceRefresh = false) {
  const listBody = document.getElementById("summon-list-body");
  if (!listBody) return;
  listBody.innerHTML = `<div style="font-size:12px; color:#475569; padding:8px;">正在連線查詢雲端未完工工程...</div>`;

  try {
    const activeList = await fetchActiveCloudProjects(forceRefresh);
    let combinedList = [...activeList];
    if (showArchivedInSummon) {
      const archList = await fetchArchivedCloudProjects(forceRefresh);
      combinedList = [...activeList, ...archList];
    }
    const kw = summonSearchText.trim().toLowerCase();
    const filtered = kw
      ? combinedList.filter(p => cleanProjectTitle(p.name).toLowerCase().includes(kw))
      : combinedList;

    const localIds = new Set(getLocalProjects().map(x => x.id));
    const hiddenSet = getHiddenIds();

    if (!filtered.length) {
      listBody.innerHTML = `<div style="font-size:12px; color:#64748B; padding:8px;">找不到符合條件的未完工雲端工程。</div>`;
      return;
    }

    listBody.innerHTML = filtered.map(p => {
      const displayTitle = cleanProjectTitle(p.name);
      const isArchived = p.archived === true;
      const isOnHome = localIds.has(p.id) && !hiddenSet.has(p.id) && !isArchived;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 9px; background:#FFF; border:1px solid ${isArchived ? "#CBD5E1" : "#BFDBFE"}; border-radius:6px;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
              <strong style="font-size:13px; color:#0F172A;">${displayTitle}</strong>
              ${isArchived
                ? `<span style="font-size:10px; background:#DCFCE7; color:#166534; font-weight:700; padding:1px 5px; border-radius:4px;">✅ 已完工封存</span>`
                : (isOnHome
                    ? `<span style="font-size:10px; background:#DBEAFE; color:#1D4ED8; padding:1px 5px; border-radius:4px;">已在首頁</span>`
                    : `<span style="font-size:10px; background:#FEF08A; color:#854D0E; font-weight:700; padding:1px 5px; border-radius:4px;">🆕 可召喚</span>`)}
            </div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">
              🕒 ${formatUpdatedTime(p.updatedAt)} · 共 ${(p.pages || []).length} 頁
            </div>
          </div>
          <div>
            ${isArchived
              ? `<button class="btn-outline btn-sm summon-unarchive-btn" data-sid="${p.id}" style="color:#D97706; border-color:#FCD34D;">↩ 解除封存</button>`
              : `<button class="btn-solid btn-sm summon-open-btn" data-sid="${p.id}">📣 召喚開啟</button>`}
          </div>
        </div>
      `;
    }).join("");

    listBody.querySelectorAll(".summon-open-btn").forEach(btn => {
      btn.onclick = async () => {
        const found = combinedList.find(p => p.id === btn.dataset.sid);
        if (!found) return;
        const s = getHiddenIds();
        s.delete(found.id);
        saveHiddenIds(s);
        upsertLocalProject(found);
        await openProjectLightweight(found);
      };
    });

    listBody.querySelectorAll(".summon-unarchive-btn").forEach(btn => {
      btn.onclick = async () => {
        const found = combinedList.find(p => p.id === btn.dataset.sid);
        if (!found) return;
        found.archived = false;
        found.updatedAt = Date.now();
        const slimPages = (found.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
        await setDoc(doc(db, PROJ_COL, found.id), { ...found, pages: slimPages });
        const s = getHiddenIds();
        s.delete(found.id);
        saveHiddenIds(s);
        upsertLocalProject(found);
        cachedCloudActiveList = null;
        cachedCloudArchivedList = null;
        renderProjectList({ openSummon: true, forceFetchCloud: true });
      };
    });
  } catch (err) {
    listBody.innerHTML = `<div style="font-size:12px; color:#DC2626; padding:8px;">雲端查詢失敗：${err.message || err}</div>`;
  }
}

async function openDatabaseCleaner() {
  const box = document.getElementById("db-cleaner-box");
  const body = document.getElementById("cleaner-body");
  box.classList.remove("hidden");
  body.innerHTML = `正在按需掃描重複工程、零碎空檔與孤兒圖片...`;
  try {
    const projSnap = await getDocs(collection(db, PROJ_COL));
    const rawProjects = [];
    projSnap.forEach(d => rawProjects.push({ id: d.id, ...d.data() }));

    const mediaSnap = await getDocs(collection(db, MEDIA_COL));
    const allMediaDocs = [];
    mediaSnap.forEach(d => allMediaDocs.push({ id: d.id, ...d.data() }));

    const groups = new Map();
    rawProjects.forEach(p => {
      const key = p.legacySourceId ? `SRC_${p.legacySourceId}` : `NAME_${cleanProjectTitle(p.name)}`;
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

    const emptyProjs = keptProjs.filter(p => !(p.pages || []).length);
    const validMediaSet = new Set();
    keptProjs.forEach(p => (p.pages || []).forEach(pg => { if (pg.mediaRefId) validMediaSet.add(String(pg.mediaRefId)); }));
    const orphanMediaDocs = allMediaDocs.filter(m => !validMediaSet.has(String(m.id)));

    if (!duplicateProjs.length && !emptyProjs.length && !orphanMediaDocs.length) {
      body.innerHTML = `<div style="color:#059669; font-weight:700; padding:6px 0;">✅ 資料庫非常乾淨！</div>`;
      return;
    }

    body.innerHTML = `
      <div style="margin-bottom:8px;">
        • 重複副本：<strong>${duplicateProjs.length}</strong> 筆 ｜ 空工程：<strong>${emptyProjs.length}</strong> 筆 ｜ 孤兒圖片：<strong>${orphanMediaDocs.length}</strong> 張
      </div>
      <button id="btn-exec-clean" class="btn-solid btn-sm" style="background:#DC2626; border-color:#DC2626;">🧹 一鍵清理全部多餘資料</button>
    `;
    document.getElementById("btn-exec-clean").onclick = async () => {
      if (!confirm("確定清理以上重複與孤兒資料嗎？")) return;
      for (const dp of [...duplicateProjs, ...emptyProjs]) {
        await deleteDoc(doc(db, PROJ_COL, dp.id)).catch(() => {});
        removeLocalProjectById(dp.id);
      }
      for (const om of orphanMediaDocs) {
        await deleteDoc(doc(db, MEDIA_COL, om.id)).catch(() => {});
      }
      cachedCloudActiveList = null;
      cachedCloudArchivedList = null;
      renderProjectList();
    };
  } catch (err) {
    body.innerHTML = `<span style="color:#DC2626;">掃描失敗：${err.message || err}</span>`;
  }
}

async function ensureSinglePagePhoto(proj, page) {
  if (!page) return "";
  if (page.sitePhotoUrl && page.sitePhotoUrl.length > 50) {
    memoryPhotoCache.set(page.id, page.sitePhotoUrl);
    return page.sitePhotoUrl;
  }
  if (memoryPhotoCache.has(page.id)) {
    page.sitePhotoUrl = memoryPhotoCache.get(page.id);
    return page.sitePhotoUrl;
  }
  if (page.mediaRefId) {
    try {
      const mDoc = await getDoc(doc(db, MEDIA_COL, String(page.mediaRefId)));
      if (mDoc.exists() && mDoc.data().imageData) {
        page.sitePhotoUrl = mDoc.data().imageData;
        memoryPhotoCache.set(page.id, page.sitePhotoUrl);
        return page.sitePhotoUrl;
      }
    } catch (_) {}
  }
  if (proj && proj.legacySourceId && page.legacyMediaId) {
    const url = await resolveLegacyMediaPhoto(proj.legacySourceId, page.legacyMediaId);
    if (url) {
      page.sitePhotoUrl = url;
      memoryPhotoCache.set(page.id, url);
      return url;
    }
  }
  return "";
}

async function openProjectLightweight(proj) {
  root.innerHTML = `<div class="card">載入空間圖集目錄中...</div>`;
  try {
    const freshSnap = await getDoc(doc(db, PROJ_COL, proj.id));
    if (freshSnap.exists()) {
      const freshData = { id: freshSnap.id, ...freshSnap.data() };
      (freshData.pages || []).forEach(pg => {
        if (memoryPhotoCache.has(pg.id)) pg.sitePhotoUrl = memoryPhotoCache.get(pg.id);
      });
      upsertLocalProject(freshData);
      openProject(freshData);
      return;
    }
  } catch (_) {}
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
  compareSpaceName = null;
  filterSpace = "ALL";
  filterCategory = "ALL";
  filterStatus = "ALL";
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
  upsertLocalProject(currentProject);
}

function getSpaceRank(sp) {
  if (!sp || sp === "未標空間") return 999;
  if (sp === "總圖") return 0;
  const order = currentProject?.spaceOrder || [];
  const idx = order.indexOf(sp);
  return idx === -1 ? 500 : idx + 1;
}

function renderWorkspace() {
  if (compareSpaceName) {
    renderSideBySideCompare(compareSpaceName);
    return;
  }
  if (activePageIdx >= 0 && currentProject.pages[activePageIdx]) {
    renderSinglePageEditor(currentProject.pages[activePageIdx]);
    return;
  }
  activeCanvasInstance = null;
  renderOverview();
}

// ==========================================
// 2. 空間圖集（瘦身大圖風 + 細細單行導覽列 + 4 大分類 + ⇅ 排序 + 替換度尺圖 / 左右對照）
// ==========================================
function renderOverview() {
  const pages = currentProject.pages || [];
  const displayTitle = cleanProjectTitle(currentProject.name);
  const contacts = Array.isArray(currentProject.contacts) ? currentProject.contacts : [];
  const allSpaces = [...new Set(pages.map(p => p.space || "未標空間"))].sort((a, b) => getSpaceRank(a) - getSpaceRank(b));

  const catCounts = { ALL: pages.length, "度尺圖": 0, "平面圖": 0, "繪圖": 0, "效果圖": 0 };
  let fixTotal = 0;
  pages.forEach(p => {
    const cat = normalizePageCategory(p);
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    (p.reviewLogs || []).forEach(r => {
      if (normalizeReviewStatus(r.status) === "NEED_FIX") fixTotal++;
    });
  });

  const filteredPages = pages.filter(p => {
    const spOk = filterSpace === "ALL" || (p.space || "未標空間") === filterSpace;
    const catOk = filterCategory === "ALL" || normalizePageCategory(p) === filterCategory;
    const stOk = filterStatus === "ALL" || (Array.isArray(p.reviewLogs) && p.reviewLogs.some(r => normalizeReviewStatus(r.status) === filterStatus));
    return spOk && catOk && stOk;
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
      [...items].sort((a, b) => (CAT_RANK[normalizePageCategory(a)] || 9) - (CAT_RANK[normalizePageCategory(b)] || 9))
    ]);

  root.innerHTML = `
    <!-- 頂部工程標題列 -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; padding:6px 10px; background:#FFF; border:1px solid #E2E8F0; border-radius:8px; margin-bottom:6px;">
      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
        <button id="btn-back-list" class="btn-outline btn-sm">‹ 目錄</button>
        <strong style="font-size:15px; color:#0F172A;">${displayTitle}</strong>
        <button id="btn-overview-contact" title="隨手臨時聯絡記錄"
                style="background:${contacts.length > 0 ? "#FEF3C7" : "#F1F5F9"}; color:${contacts.length > 0 ? "#92400E" : "#475569"}; border:1px solid ${contacts.length > 0 ? "#F59E0B" : "#CBD5E1"}; border-radius:999px; padding:1px 7px; font-size:12px; font-weight:700; cursor:pointer;">
          👤${contacts.length > 0 ? ` ${contacts.length}` : ""}
        </button>
        <button id="btn-overview-rename" title="修改工程名稱"
                style="background:none; border:1px solid #E2E8F0; border-radius:5px; padding:1px 5px; font-size:11px; color:#64748B; cursor:pointer;">
          ✏️
        </button>
      </div>
      <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
        <button id="btn-phrase-mgr-open" class="btn-outline btn-sm" style="color:#475569;" title="管理審圖快捷短語庫">⚙️ 短語庫</button>
        <button id="btn-review-board" class="btn-outline btn-sm" style="border-color:#FCA5A5; color:#DC2626; font-weight:700;">
          📋 批改總表${fixTotal > 0 ? ` (${fixTotal})` : ""}
        </button>
        <button id="btn-add-space" class="btn-outline btn-sm">+ 空間</button>
        <button id="btn-open-report" class="btn-solid btn-sm">客戶報告</button>
      </div>
    </div>

    <!-- 👤 隨手臨時聯絡記錄面板 -->
    <div id="overview-contact-box" class="hidden" style="margin-bottom:6px;">
      ${renderContactDrawerHtml(currentProject)}
    </div>

    <!-- ⚙️ 審圖快捷短語管理面板 -->
    <div id="phrase-manager-box" class="card hidden" style="background:#F8FAFC; border:1.5px solid #3B82F6; margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#1E3A8A;">⚙️ 管理審圖快捷短語庫（雲端同步，拉箭頭與批改時一鍵帶入）</strong>
        <button id="btn-close-phrase-mgr" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="phrase-manager-body"></div>
    </div>

    <!-- 📋 批改總表面板 -->
    <div id="project-review-board" class="card hidden" style="background:#FFFBFB; border:1.5px solid #FCA5A5; margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#991B1B;">📋 本工程審圖批改總表（點擊狀態徽章可切換）</strong>
        <button id="btn-close-review-board" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="project-review-list" style="display:flex; flex-direction:column; gap:5px; font-size:12px;"></div>
    </div>

    <!-- 細細的單行導覽列（左邊空間切換 + ⇅ 排序；右邊 4 大分類：度尺圖/平面圖/繪圖/效果圖） -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 8px; background:#FFF; border:1px solid #E2E8F0; border-radius:999px; margin-bottom:8px; overflow-x:auto; white-space:nowrap;">
      <div style="display:flex; align-items:center; gap:4px;">
        <button id="btn-space-sort-toggle" title="調整空間先後次序"
                style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:999px; padding:2px 7px; font-size:11px; font-weight:800; color:#334155; cursor:pointer;">
          ⇅ 排序
        </button>
        <button class="slim-chip ${filterSpace === "ALL" ? "active" : ""}" data-fsp="ALL">全部空間</button>
        ${allSpaces.map(sp => `
          <button class="slim-chip ${filterSpace === sp ? "active" : ""}" data-fsp="${sp}">${sp}</button>
        `).join("")}
      </div>

      <div style="display:flex; align-items:center; gap:4px; padding-left:6px; border-left:1px solid #E2E8F0;">
        <button class="slim-chip ${filterCategory === "ALL" ? "active" : ""}" data-fcat="ALL">全部(${pages.length})</button>
        ${CORE_CATEGORIES.map(cat => `
          <button class="slim-chip ${filterCategory === cat ? "active" : ""}" data-fcat="${cat}">${cat}(${catCounts[cat] || 0})</button>
        `).join("")}
      </div>
    </div>

    <!-- ⇅ 空間排序小面板（支援手機/平板按 ↑ ↓ 調整次序） -->
    <div id="space-sort-drawer" class="hidden" style="background:#FFF; border:1px solid #CBD5E1; border-radius:8px; padding:8px 10px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:12px; color:#1E293B;">⇅ 調整空間顯示次序（即時自動儲存）</strong>
        <button id="btn-close-space-sort" class="btn-outline btn-sm" style="padding:1px 7px; font-size:11px;">完成</button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${allSpaces.filter(s => s !== "總圖" && s !== "未標空間").map((sp, idx, arr) => `
          <div style="display:flex; align-items:center; gap:4px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; padding:3px 7px; font-size:12px;">
            <strong>${sp}</strong>
            <button class="btn-sp-move" data-spname="${sp}" data-dir="-1" ${idx === 0 ? "disabled" : ""} style="border:1px solid #CBD5E1; background:#FFF; border-radius:4px; padding:0 5px; cursor:pointer;">↑</button>
            <button class="btn-sp-move" data-spname="${sp}" data-dir="1" ${idx === arr.length - 1 ? "disabled" : ""} style="border:1px solid #CBD5E1; background:#FFF; border-radius:4px; padding:0 5px; cursor:pointer;">↓</button>
          </div>
        `).join("") || `<span style="font-size:12px; color:#64748B;">目前沒有可排序的多個空間。</span>`}
      </div>
    </div>

    <!-- 新增空間圖紙面板 -->
    <div id="dict-picker-box" class="card ${pages.length === 0 ? "" : "hidden"}" style="margin-bottom:8px;">
      <div class="section-title">第一步：選擇空間</div>
      <div class="chip-grid" id="picker-spaces" style="margin-bottom:8px;"></div>
      <div class="section-title">第二步：選擇訂造櫃體（選填）</div>
      <div class="chip-grid" id="picker-cabs" style="margin-bottom:10px;"></div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <input type="text" id="custom-page-title" placeholder="空間名稱（如：玄關、主人房）" style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #111827; border-radius:4px; font-size:13px;" />
        <select id="new-page-doctype" style="padding:5px 8px; border:1px solid #111827; border-radius:4px; font-size:13px; font-weight:700;">
          <option value="度尺圖">度尺圖</option>
          <option value="平面圖">平面圖</option>
          <option value="繪圖">繪圖</option>
          <option value="效果圖">效果圖</option>
        </select>
        <button id="btn-confirm-page" class="btn-solid btn-sm">建立</button>
      </div>
    </div>

    <!-- 隱藏檔案輸入框（供一鍵「📷 替換度尺圖」使用） -->
    <input type="file" id="quick-replace-measure-input" accept="image/*" class="hidden" />

    <!-- 簡約大圖空間圖集 -->
    <div id="main-gallery-host"></div>

    <style>
      .slim-chip { background:transparent; border:1px solid transparent; border-radius:999px; padding:2px 8px; font-size:12px; font-weight:600; color:#475569; cursor:pointer; }
      .slim-chip:hover { background:#F1F5F9; }
      .slim-chip.active { background:#0F172A; color:#FFFFFF; }
    </style>
  `;

  document.getElementById("btn-back-list").onclick = () => renderProjectList();
  document.getElementById("btn-add-space").onclick = () => document.getElementById("dict-picker-box").classList.toggle("hidden");

  document.getElementById("btn-overview-contact").onclick = () => {
    document.getElementById("overview-contact-box").classList.toggle("hidden");
  };
  const ovBox = document.getElementById("overview-contact-box");
  if (ovBox) {
    ovBox.querySelectorAll(".btn-contact-close").forEach(b => b.onclick = () => ovBox.classList.add("hidden"));
    ovBox.querySelectorAll(".btn-ct-add").forEach(b => {
      b.onclick = async () => {
        const nameVal = (document.getElementById(`ct-name-${currentProject.id}`)?.value || "").trim();
        const phoneVal = (document.getElementById(`ct-phone-${currentProject.id}`)?.value || "").trim();
        if (!nameVal && !phoneVal) return;
        if (!Array.isArray(currentProject.contacts)) currentProject.contacts = [];
        currentProject.contacts.push({ name: nameVal || "聯絡記錄", phone: phoneVal });
        await saveCurrentProject();
        renderOverview();
        document.getElementById("overview-contact-box")?.classList.remove("hidden");
      };
    });
    ovBox.querySelectorAll(".btn-ct-del").forEach(b => {
      b.onclick = async () => {
        currentProject.contacts.splice(Number(b.dataset.cidx), 1);
        await saveCurrentProject();
        renderOverview();
        document.getElementById("overview-contact-box")?.classList.remove("hidden");
      };
    });
  }

  document.getElementById("btn-overview-rename").onclick = async () => {
    const nextName = prompt("修改工程名稱：", cleanProjectTitle(currentProject.name));
    if (nextName === null) return;
    const trimmed = cleanProjectTitle(nextName);
    if (!trimmed || trimmed === currentProject.name) return;
    await renameProjectEverywhere(currentProject, trimmed);
    renderOverview();
  };

  document.getElementById("btn-phrase-mgr-open").onclick = () => {
    const box = document.getElementById("phrase-manager-box");
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) renderPhraseManagerUI();
  };
  document.getElementById("btn-close-phrase-mgr").onclick = () => {
    document.getElementById("phrase-manager-box").classList.add("hidden");
  };

  document.getElementById("btn-open-report").onclick = async () => {
    root.innerHTML = `<div class="card">正在為報告預覽按需載入底圖...</div>`;
    await Promise.all((currentProject.pages || []).map(pg => ensureSinglePagePhoto(currentProject, pg)));
    renderReportBuilder(root, currentProject, renderWorkspace);
  };

  document.getElementById("btn-review-board").onclick = () => {
    const board = document.getElementById("project-review-board");
    board.classList.toggle("hidden");
    if (!board.classList.contains("hidden")) renderProjectReviewList();
  };
  document.getElementById("btn-close-review-board").onclick = () => {
    document.getElementById("project-review-board").classList.add("hidden");
  };

  // ⇅ 排序開關與上下移按鈕
  document.getElementById("btn-space-sort-toggle").onclick = () => {
    document.getElementById("space-sort-drawer").classList.toggle("hidden");
  };
  document.getElementById("btn-close-space-sort").onclick = () => {
    document.getElementById("space-sort-drawer").classList.add("hidden");
  };

  const sortableSpaces = allSpaces.filter(s => s !== "總圖" && s !== "未標空間");
  root.querySelectorAll(".btn-sp-move").forEach(btn => {
    btn.onclick = async () => {
      const spName = btn.dataset.spname;
      const dir = Number(btn.dataset.dir);
      const nextOrder = [...sortableSpaces];
      const idx = nextOrder.indexOf(spName);
      if (idx === -1 || idx + dir < 0 || idx + dir >= nextOrder.length) return;
      [nextOrder[idx], nextOrder[idx + dir]] = [nextOrder[idx + dir], nextOrder[idx]];
      currentProject.spaceOrder = nextOrder;
      await saveCurrentProject();
      renderOverview();
      document.getElementById("space-sort-drawer")?.classList.remove("hidden");
    };
  });

  root.querySelectorAll("[data-fsp]").forEach(btn => {
    btn.onclick = () => { filterSpace = btn.dataset.fsp; renderOverview(); };
  });
  root.querySelectorAll("[data-fcat]").forEach(btn => {
    btn.onclick = () => { filterCategory = btn.dataset.fcat; renderOverview(); };
  });

  setupDictPicker();

  const galleryHost = document.getElementById("main-gallery-host");
  if (filterSpace === "ALL") {
    renderCleanFolderGrid(galleryHost, sortedGroups, pages);
  } else {
    renderExpandedSpacePages(galleryHost, sortedGroups, pages);
  }
}

// 簡約大圖風空間卡片（附「📷 替換度尺圖」與「⚖️ 左右對照」）
function renderCleanFolderGrid(host, sortedGroups, allPages) {
  let pendingReplaceSpace = null;
  const replaceInput = document.getElementById("quick-replace-measure-input");

  replaceInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !pendingReplaceSpace) return;
    const spPages = (currentProject.pages || []).filter(p => (p.space || "未標空間") === pendingReplaceSpace);
    let targetPage = spPages.find(p => normalizePageCategory(p) === "度尺圖");
    if (!targetPage) {
      targetPage = {
        id: "PG_" + Date.now(),
        pageNum: `P${currentProject.pages.length + 1}`,
        space: pendingReplaceSpace,
        docTypeLabel: "度尺圖",
        title: `${pendingReplaceSpace} · 度尺圖`,
        sitePhotoUrl: "",
        lines: [], markers: [], paths: [], arrows: [], stickers: [], reviewLogs: []
      };
      currentProject.pages.push(targetPage);
    }
    const res = await uploadMediaToCloud(currentProject.id, targetPage.id, file);
    targetPage.sitePhotoUrl = res.imageData;
    targetPage.docTypeLabel = "度尺圖";
    memoryPhotoCache.set(targetPage.id, res.imageData);
    await saveCurrentProject();
    pendingReplaceSpace = null;
    replaceInput.value = "";
    renderOverview();
  };

  host.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(275px, 1fr)); gap:12px;">
      ${sortedGroups.map(([spaceName, items]) => {
        const activeSubIdx = Math.min(folderCoverIndex[spaceName] || 0, items.length - 1);
        const coverPage = items[activeSubIdx];
        const coverCat = normalizePageCategory(coverPage);
        const coverCachedUrl = coverPage.sitePhotoUrl || memoryPhotoCache.get(coverPage.id) || "";
        const fixCnt = items.reduce((acc, pg) => acc + (pg.reviewLogs || []).filter(r => normalizeReviewStatus(r.status) === "NEED_FIX").length, 0);

        return `
          <div style="background:#FFF; border:1px solid #E2E8F0; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 3px rgba(15,23,42,0.04);">
            <!-- 乾淨頂部：空間名 + 分類小標籤 + 張數 -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 11px;">
              <div style="display:flex; align-items:center; gap:6px;">
                <strong style="font-size:15px; color:#0F172A;">${spaceName}</strong>
                <span style="font-size:11px; color:#2563EB; background:#EFF6FF; padding:1px 6px; border-radius:4px; font-weight:700;">${coverCat}</span>
                ${fixCnt > 0 ? `<span style="font-size:10px; background:#FEE2E2; color:#991B1B; font-weight:800; padding:1px 5px; border-radius:4px;">❌${fixCnt}</span>` : ""}
              </div>
              <span style="font-size:11px; font-weight:700; color:#64748B;">${items.length}張</span>
            </div>

            <!-- 簡約大圖預覽區 -->
            <div class="folder-main-preview" data-open-page="${allPages.indexOf(coverPage)}"
                 style="height:190px; margin:0 10px; background:#F8FAFC; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden;">
              ${coverCachedUrl
                ? `<img src="${coverCachedUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                : `<div style="text-align:center; color:#475569; font-size:12px; padding:12px;">
                     <div style="font-size:24px; margin-bottom:4px;">📐</div>
                     <div style="font-weight:700;">點擊開啟「${coverCat}」</div>
                     <div style="font-size:10px; color:#94A3B8; margin-top:2px;">按需單頁載入 · 省數據</div>
                   </div>`}
            </div>

            <!-- 頁碼切換膠囊列 -->
            <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px 4px 10px; gap:4px;">
              <div style="display:flex; align-items:center; gap:4px; overflow-x:auto;">
                ${items.slice(0, 5).map((tp, tIdx) => {
                  const catShort = normalizePageCategory(tp).slice(0, 2);
                  return `
                    <button class="mini-thumb-btn" data-thumb-space="${spaceName}" data-thumb-idx="${tIdx}"
                            style="padding:2px 6px; font-size:10px; border-radius:4px; border:${tIdx === activeSubIdx ? "1.5px solid #2563EB" : "1px solid #E2E8F0"}; background:${tIdx === activeSubIdx ? "#EFF6FF" : "#F8FAFC"}; color:${tIdx === activeSubIdx ? "#1D4ED8" : "#64748B"}; font-weight:700; cursor:pointer; white-space:nowrap;">
                      ${catShort}${tIdx + 1}
                    </button>
                  `;
                }).join("")}
                ${items.length > 5 ? `<span style="font-size:10px; color:#94A3B8;">+${items.length - 5}</span>` : ""}
              </div>
              <button class="folder-expand-btn" data-expand-space="${spaceName}"
                      style="background:none; border:none; color:#475569; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">
                全部 ›
              </button>
            </div>

            <!-- 兩大日常核心操作列：📷 替換度尺圖 ＋ ⚖️ 左右對照 -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; padding:6px 10px 9px 10px; border-top:1px solid #F1F5F9;">
              <button class="btn-quick-replace-measure" data-rspace="${spaceName}"
                      style="background:#F0FDF4; color:#166534; border:1px solid #BBF7D0; border-radius:6px; padding:5px 6px; font-size:12px; font-weight:800; cursor:pointer;">
                📷 替換度尺圖
              </button>
              <button class="btn-quick-compare" data-cspace="${spaceName}"
                      style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:6px; padding:5px 6px; font-size:12px; font-weight:800; cursor:pointer;">
                ⚖️ 左右對照
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
      renderOverview();
    };
  });

  host.querySelectorAll(".folder-main-preview").forEach(box => {
    box.onclick = () => {
      activePageIdx = Number(box.dataset.openPage);
      renderWorkspace();
    };
  });

  host.querySelectorAll(".btn-quick-replace-measure").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      pendingReplaceSpace = btn.dataset.rspace;
      replaceInput.click();
    };
  });

  host.querySelectorAll(".btn-quick-compare").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      compareSpaceName = btn.dataset.cspace;
      renderWorkspace();
    };
  });
}

function renderExpandedSpacePages(host, sortedGroups, allPages) {
  host.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      ${sortedGroups.map(([spaceName, items]) => `
        <div style="background:#FFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:15px; color:#0F172A;">${spaceName}</strong>
              <span style="font-size:11px; background:#F1F5F9; color:#475569; padding:1px 7px; border-radius:999px; font-weight:700;">${items.length}張</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn-outline btn-sm btn-exp-compare" data-cspace="${spaceName}" style="color:#1D4ED8; border-color:#BFDBFE; font-weight:700;">⚖️ 左右對照</button>
              <button class="btn-outline btn-sm btn-back-all-folders">‹ 返回全部圖集</button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:9px;">
            ${items.map(p => {
              const realIdx = allPages.indexOf(p);
              const cat = normalizePageCategory(p);
              const cachedUrl = p.sitePhotoUrl || memoryPhotoCache.get(p.id) || "";
              const annCnt = (p.lines || []).length + (p.markers || []).length + (p.paths || []).length + (p.arrows || []).length;
              return `
                <div class="page-grid-card" data-open-idx="${realIdx}"
                     style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; overflow:hidden; cursor:pointer;">
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:#FFF; border-bottom:1px solid #F1F5F9; font-size:12px;">
                    <strong style="color:#1E293B;">${p.pageNum || `P${realIdx + 1}`} · ${cat}</strong>
                    ${annCnt > 0 ? `<span style="font-size:10px; background:#EFF6FF; color:#1D4ED8; padding:1px 5px; border-radius:4px; font-weight:700;">📐${annCnt}</span>` : ""}
                  </div>
                  <div style="height:160px; display:flex; align-items:center; justify-content:center;">
                    ${cachedUrl
                      ? `<img src="${cachedUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                      : `<span style="font-size:12px; color:#64748B;">點擊開啟度尺批改</span>`}
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
    btn.onclick = () => { filterSpace = "ALL"; renderOverview(); };
  });
  host.querySelectorAll(".btn-exp-compare").forEach(btn => {
    btn.onclick = () => { compareSpaceName = btn.dataset.cspace; renderWorkspace(); };
  });
  host.querySelectorAll("[data-open-idx]").forEach(card => {
    card.onclick = () => { activePageIdx = Number(card.dataset.openIdx); renderWorkspace(); };
  });
}

// ==========================================
// 3. ⚖️ 左右對照檢查模式（左邊度尺圖，右邊平面圖／繪圖／效果圖並排核對與批改）
// ==========================================
async function renderSideBySideCompare(spaceName) {
  const allPages = currentProject.pages || [];
  const spacePages = allPages.filter(p => (p.space || "未標空間") === spaceName);
  if (!spacePages.length) {
    compareSpaceName = null;
    renderOverview();
    return;
  }

  let leftPage = spacePages.find(p => normalizePageCategory(p) === "度尺圖") || spacePages[0];
  let rightPage = spacePages.find(p => normalizePageCategory(p) !== "度尺圖") || spacePages[Math.min(1, spacePages.length - 1)];

  root.innerHTML = `
    <div style="position:fixed; inset:0; width:100vw; height:100vh; background:#F8FAFC; display:flex; flex-direction:column; z-index:920;">
      <!-- 頂部極簡導覽列 -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 10px; background:#FFF; border-bottom:1px solid #E2E8F0; gap:6px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-exit-compare" style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer;">‹ 返回圖集</button>
          <strong style="font-size:14px; color:#0F172A;">⚖️ 左右對照檢查 · ${spaceName}</strong>
        </div>

        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <select id="cmp-left-sel" style="padding:3px 6px; border:1px solid #86EFAC; background:#F0FDF4; border-radius:5px; font-size:12px; font-weight:700; color:#166534;">
            ${spacePages.map((p, i) => `<option value="${i}" ${p === leftPage ? "selected" : ""}>左：${p.pageNum || `P${i + 1}`} ${normalizePageCategory(p)}</option>`).join("")}
          </select>
          <select id="cmp-right-sel" style="padding:3px 6px; border:1px solid #93C5FD; background:#EFF6FF; border-radius:5px; font-size:12px; font-weight:700; color:#1D4ED8;">
            ${spacePages.map((p, i) => `<option value="${i}" ${p === rightPage ? "selected" : ""}>右：${p.pageNum || `P${i + 1}`} ${normalizePageCategory(p)}</option>`).join("")}
          </select>
        </div>
      </div>

      <!-- 左右雙屏主體 -->
      <div style="flex:1; display:grid; grid-template-columns:1fr 1fr; gap:4px; background:#E2E8F0; overflow:hidden;">
        <div style="background:#FFF; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 8px; background:#F0FDF4; border-bottom:1px solid #DCFCE7; font-size:11px;">
            <strong id="cmp-left-title" style="color:#166534;">左圖：${normalizePageCategory(leftPage)}</strong>
            <button id="btn-cmp-edit-left" style="background:#16A34A; color:#FFF; border:none; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700; cursor:pointer;">✏️ 全屏批改左圖</button>
          </div>
          <div id="cmp-left-body" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:6px;">
            <span style="color:#94A3B8; font-size:12px;">按需載入左圖中...</span>
          </div>
        </div>

        <div style="background:#FFF; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 8px; background:#EFF6FF; border-bottom:1px solid #DBEAFE; font-size:11px;">
            <strong id="cmp-right-title" style="color:#1D4ED8;">右圖：${normalizePageCategory(rightPage)}</strong>
            <button id="btn-cmp-edit-right" style="background:#2563EB; color:#FFF; border:none; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700; cursor:pointer;">✏️ 全屏批改右圖</button>
          </div>
          <div id="cmp-right-body" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:6px;">
            <span style="color:#94A3B8; font-size:12px;">按需載入右圖中...</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const renderBothImages = async () => {
    const lUrl = await ensureSinglePagePhoto(currentProject, leftPage);
    const rUrl = await ensureSinglePagePhoto(currentProject, rightPage);
    const lBody = document.getElementById("cmp-left-body");
    const rBody = document.getElementById("cmp-right-body");
    document.getElementById("cmp-left-title").textContent = `左圖：${leftPage.pageNum || ""} ${normalizePageCategory(leftPage)}`;
    document.getElementById("cmp-right-title").textContent = `右圖：${rightPage.pageNum || ""} ${normalizePageCategory(rightPage)}`;

    if (lBody) {
      lBody.innerHTML = lUrl
        ? `<img src="${lUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />`
        : `<span style="color:#94A3B8; font-size:12px;">此頁尚未上傳圖片</span>`;
    }
    if (rBody) {
      rBody.innerHTML = rUrl
        ? `<img src="${rUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />`
        : `<span style="color:#94A3B8; font-size:12px;">此頁尚未上傳圖片</span>`;
    }
  };

  document.getElementById("btn-exit-compare").onclick = () => {
    compareSpaceName = null;
    renderOverview();
  };
  document.getElementById("cmp-left-sel").onchange = (e) => {
    leftPage = spacePages[Number(e.target.value)];
    renderBothImages();
  };
  document.getElementById("cmp-right-sel").onchange = (e) => {
    rightPage = spacePages[Number(e.target.value)];
    renderBothImages();
  };
  document.getElementById("btn-cmp-edit-left").onclick = () => {
    compareSpaceName = null;
    activePageIdx = allPages.indexOf(leftPage);
    renderWorkspace();
  };
  document.getElementById("btn-cmp-edit-right").onclick = () => {
    compareSpaceName = null;
    activePageIdx = allPages.indexOf(rightPage);
    renderWorkspace();
  };

  await renderBothImages();
}

// ==========================================
// 4. 審圖快捷短語庫管理 & 批改總表（4 種狀態）
// ==========================================
function renderPhraseManagerUI(onUpdatedCallback = null) {
  const body = document.getElementById("phrase-manager-body");
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:8px;">
      <select id="pm-new-cat" style="padding:4px 6px; border:1px solid #CBD5E1; border-radius:4px; font-size:12px;">
        <option value="搬運收口">搬運收口</option>
        <option value="門窗碰撞">門窗碰撞</option>
        <option value="水電冷氣">水電冷氣</option>
        <option value="廚浴電器">廚浴電器</option>
        <option value="自訂常用">自訂常用</option>
      </select>
      <input type="text" id="pm-new-text" placeholder="輸入新短語（如：⚠️ 收口改35mm）"
             style="flex:1; min-width:170px; padding:4px 7px; border:1px solid #CBD5E1; border-radius:4px; font-size:12px;" />
      <button id="btn-pm-add" class="btn-solid btn-sm">+ 新增短語</button>
    </div>
    <div style="max-height:210px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;">
      ${customPhraseBank.map((p, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; background:#FFF; border:1px solid #E2E8F0; border-radius:5px; padding:4px 7px; font-size:12px;">
          <div>
            <span style="font-size:10px; background:#EFF6FF; color:#1D4ED8; padding:1px 5px; border-radius:3px; font-weight:700; margin-right:5px;">${p.cat || "常用"}</span>
            <span>${p.text}</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button class="btn-pm-edit" data-idx="${idx}" style="background:none; border:none; color:#475569; cursor:pointer; font-size:11px;">✏️</button>
            <button class="btn-pm-del" data-idx="${idx}" style="background:none; border:none; color:#DC2626; cursor:pointer; font-size:12px;">✕</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("btn-pm-add").onclick = async () => {
    const cat = document.getElementById("pm-new-cat").value;
    const txt = document.getElementById("pm-new-text").value.trim();
    if (!txt) return;
    customPhraseBank.unshift({ cat, text: txt });
    await saveCustomPhraseBank();
    renderPhraseManagerUI(onUpdatedCallback);
    if (onUpdatedCallback) onUpdatedCallback();
  };

  body.querySelectorAll(".btn-pm-edit").forEach(b => {
    b.onclick = async () => {
      const idx = Number(b.dataset.idx);
      const next = prompt("修改短語內容：", customPhraseBank[idx].text);
      if (next && next.trim()) {
        customPhraseBank[idx].text = next.trim();
        await saveCustomPhraseBank();
        renderPhraseManagerUI(onUpdatedCallback);
        if (onUpdatedCallback) onUpdatedCallback();
      }
    };
  });

  body.querySelectorAll(".btn-pm-del").forEach(b => {
    b.onclick = async () => {
      customPhraseBank.splice(Number(b.dataset.idx), 1);
      await saveCustomPhraseBank();
      renderPhraseManagerUI(onUpdatedCallback);
      if (onUpdatedCallback) onUpdatedCallback();
    };
  });
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
    host.innerHTML = `<div style="color:#6B7280; padding:6px 0;">尚無審圖批改記錄。進入圖紙拉「↗ 箭頭」打字或點「📝 批改記錄」即可建立。</div>`;
    return;
  }

  host.innerHTML = rows.map(({ p, pIdx, log, lIdx }) => {
    const stKey = normalizeReviewStatus(log.status);
    const meta = REVIEW_STATUS_META[stKey];
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; background:#FFF; border:1px solid ${meta.border}; border-radius:6px;">
        <div style="flex:1; cursor:pointer;" class="rev-jump-page" data-pidx="${pIdx}">
          <div style="font-weight:700; color:#1E293B;">
            ${p.pageNum || `P${pIdx + 1}`} ${p.space || ""} · ${normalizePageCategory(p)}
            <span style="font-weight:400; color:#64748B; font-size:11px; margin-left:4px;">${log.time || ""}</span>
          </div>
          <div style="color:${meta.text}; margin-top:2px; font-weight:600;">${log.note}</div>
        </div>
        <button class="btn-outline btn-sm rev-cycle-status" data-pidx="${pIdx}" data-lidx="${lIdx}"
                style="background:${meta.bg}; color:${meta.text}; border-color:${meta.border}; font-weight:800; white-space:nowrap;">
          ${meta.label} ↻
        </button>
      </div>
    `;
  }).join("");

  host.querySelectorAll(".rev-jump-page").forEach(el => {
    el.onclick = () => { activePageIdx = Number(el.dataset.pidx); renderWorkspace(); };
  });

  host.querySelectorAll(".rev-cycle-status").forEach(btn => {
    btn.onclick = async () => {
      const p = currentProject.pages[Number(btn.dataset.pidx)];
      const log = p?.reviewLogs?.[Number(btn.dataset.lidx)];
      if (!log) return;
      const cur = normalizeReviewStatus(log.status);
      const next = STATUS_CYCLE_ORDER[(STATUS_CYCLE_ORDER.indexOf(cur) + 1) % STATUS_CYCLE_ORDER.length];
      log.status = next;
      await saveCurrentProject();
      renderProjectReviewList();
    };
  });
}

function setupDictPicker() {
  let selSpace = "";
  let selCab = "";
  const titleInput = document.getElementById("custom-page-title");
  if (!titleInput) return;

  const updateTitle = () => { titleInput.value = [selSpace, selCab].filter(Boolean).join("-"); };
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
      lines: [], markers: [], paths: [], arrows: [], stickers: [], reviewLogs: []
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

// ==========================================
// 5. 全屏無黑邊批改編輯器（↗ 箭頭即打字 ＋ 4 種狀態 ＋ 40 條短語庫）
// ==========================================
async function renderSinglePageEditor(page) {
  const totalPages = currentProject.pages.length;
  const catLabel = normalizePageCategory(page);
  const pageTitleText = `${page.pageNum || `P${activePageIdx + 1}`} ${page.space || ""} · ${catLabel}`.trim();
  if (!Array.isArray(page.reviewLogs)) page.reviewLogs = [];

  root.innerHTML = `
    <div id="fullscreen-editor-shell" style="position:fixed; inset:0; width:100vw; height:100vh; background:#F8FAFC; display:flex; flex-direction:column; z-index:900; overflow:hidden;">
      <!-- 頂部清爽白底細導覽列（沒有黑邊） -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 10px; background:#FFFFFF; border-bottom:1px solid #E2E8F0; flex-wrap:wrap; gap:6px; z-index:20;">
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-back-grid" style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer;">
            ‹ 返回圖集
          </button>
          <strong style="font-size:14px; color:#0F172A;">${pageTitleText}</strong>
          <span style="font-size:11px; color:#64748B;">(${activePageIdx + 1}/${totalPages})</span>
        </div>

        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
          <button id="btn-toggle-white-bg" style="background:#F8FAFC; color:#0F172A; border:1px solid #CBD5E1; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:700; cursor:pointer;">
            📄 白底
          </button>
          <button id="btn-page-review-drawer" style="background:#FEF2F2; color:#991B1B; border:1px solid #FCA5A5; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">
            📝 批改記錄 (${page.reviewLogs.length})
          </button>
          <button id="btn-manual-save" style="background:#059669; color:#FFF; border:none; border-radius:6px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer;">
            💾 儲存
          </button>
          <label style="background:#F1F5F9; color:#334155; border:1px solid #CBD5E1; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:700; cursor:pointer;">
            📷 換底圖
            <input type="file" id="up-site-photo" accept="image/*" class="hidden" />
          </label>
        </div>
      </div>

      <!-- 寬敞多行批改打字與 4 種狀態面板 -->
      <div id="page-review-drawer" class="hidden" style="position:absolute; right:12px; top:44px; width:min(360px, 94vw); max-height:78vh; overflow-y:auto; background:#FFFFFF; color:#0F172A; border:1.5px solid #CBD5E1; border-radius:10px; padding:10px; box-shadow:0 12px 28px rgba(15,23,42,0.18); z-index:40; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:5px;">
          <strong style="font-size:13px; color:#0F172A;">📝 本頁審圖批改記錄</strong>
          <button id="btn-close-page-rev" style="background:none; border:none; color:#64748B; font-size:14px; cursor:pointer;">✕</button>
        </div>

        <div style="display:flex; gap:5px; align-items:center;">
          <select id="new-rev-status" style="padding:4px 6px; border-radius:5px; border:1px solid #CBD5E1; font-size:12px; font-weight:700;">
            <option value="NEED_FIX">❌ 需修改</option>
            <option value="SITE_CHECK">⚠️ 現場核對</option>
            <option value="NEED_INFO">📌 待補資料</option>
            <option value="OK">✅ 確認無誤</option>
          </select>
          <button id="btn-drawer-phrase-mgr" style="margin-left:auto; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:5px; padding:3px 7px; font-size:11px; cursor:pointer;">⚙️ 管理短語</button>
        </div>

        <textarea id="new-rev-note" rows="2" placeholder="直接打字輸入批改要求，或點下方快捷短語一鍵帶入..."
                  style="width:100%; box-sizing:border-box; padding:6px 8px; border-radius:6px; border:1.5px solid #93C5FD; font-size:13px; resize:vertical; font-family:inherit;"></textarea>

        <!-- 快捷短語一鍵帶入區 -->
        <div id="drawer-phrase-chips" style="display:flex; flex-wrap:wrap; gap:4px; max-height:92px; overflow-y:auto;">
          ${customPhraseBank.slice(0, 16).map(p => `
            <button type="button" class="drw-phrase-chip" data-ptext="${p.text.replace(/"/g, "&quot;")}"
                    style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:4px; padding:2px 6px; font-size:11px; color:#334155; cursor:pointer;">
              ${p.text}
            </button>
          `).join("")}
        </div>

        <button id="btn-add-rev-note" style="background:#2563EB; color:#FFF; border:none; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:800; cursor:pointer;">
          + 新增批改記錄
        </button>

        <div id="page-rev-items" style="display:flex; flex-direction:column; gap:5px; font-size:12px;"></div>
      </div>

      <!-- 無黑邊畫布容器 -->
      <div id="sub-module-host" style="flex:1; width:100%; height:100%; position:relative; overflow:hidden; background:#F8FAFC;">
        <div style="color:#64748B; text-align:center; padding:50px; font-size:14px;">正在按需載入本頁底圖...</div>
      </div>
    </div>
  `;

  root.querySelectorAll(".drw-phrase-chip").forEach(btn => {
    btn.onclick = () => {
      const inp = document.getElementById("new-rev-note");
      inp.value = inp.value ? `${inp.value} ${btn.dataset.ptext}` : btn.dataset.ptext;
      inp.focus();
    };
  });

  const renderPageRevItems = () => {
    const listEl = document.getElementById("page-rev-items");
    const badgeBtn = document.getElementById("btn-page-review-drawer");
    if (badgeBtn) badgeBtn.textContent = `📝 批改記錄 (${page.reviewLogs.length})`;
    if (!listEl) return;
    if (!page.reviewLogs.length) {
      listEl.innerHTML = `<div style="color:#94A3B8; font-size:11px;">尚無批改記錄，可使用「↗ 箭頭」拉線即打字或在上方輸入。</div>`;
      return;
    }
    listEl.innerHTML = page.reviewLogs.map((r, i) => {
      const stKey = normalizeReviewStatus(r.status);
      const meta = REVIEW_STATUS_META[stKey];
      return `
        <div style="background:${meta.bg}; border:1px solid ${meta.border}; border-radius:6px; padding:6px 8px; display:flex; justify-content:space-between; align-items:center; gap:6px;">
          <div style="flex:1;">
            <div style="font-size:10px; color:#64748B;">${r.time || ""}</div>
            <div style="color:${meta.text}; font-weight:700; white-space:pre-wrap;">${r.note}</div>
          </div>
          <button class="page-rev-cycle" data-ridx="${i}" style="background:${meta.badgeBg}; color:${meta.badgeText}; border:none; border-radius:4px; padding:3px 7px; font-size:10px; font-weight:800; cursor:pointer; white-space:nowrap;">
            ${meta.label} ↻
          </button>
          <button class="page-rev-del" data-ridx="${i}" style="background:none; border:none; color:#64748B; font-size:12px; cursor:pointer;">✕</button>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".page-rev-cycle").forEach(b => {
      b.onclick = async () => {
        const item = page.reviewLogs[Number(b.dataset.ridx)];
        if (!item) return;
        const cur = normalizeReviewStatus(item.status);
        item.status = STATUS_CYCLE_ORDER[(STATUS_CYCLE_ORDER.indexOf(cur) + 1) % STATUS_CYCLE_ORDER.length];
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
    const st = document.getElementById("new-rev-status").value;
    const txt = inp.value.trim();
    if (!txt) return;
    const now = new Date();
    const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    page.reviewLogs.unshift({ time: tStr, note: txt, status: st });
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

  const host = document.getElementById("sub-module-host");

  const showMeasure = () => {
    if (!page.sitePhotoUrl) {
      host.innerHTML = `<div style="color:#475569; text-align:center; padding:50px; font-size:15px;">請先點擊右上角「📷 換底圖」拍照，或按「📄 白底」直接開白底草圖。</div>`;
      return;
    }
    activeCanvasInstance = new MeasureCanvas(
      host,
      page.sitePhotoUrl,
      {
        lines: page.lines || [],
        markers: page.markers || [],
        paths: page.paths || [],
        arrows: page.arrows || [],
        stickers: page.stickers || []
      },
      masterDict.rulerColors,
      async (updated) => {
        page.lines = updated.lines || [];
        page.markers = updated.markers || [];
        if (updated.paths) page.paths = updated.paths;
        if (updated.arrows) page.arrows = updated.arrows;
        if (updated.stickers) page.stickers = updated.stickers;
        if (updated.newReviewNote) {
          const now = new Date();
          const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          page.reviewLogs.unshift({ time: tStr, note: updated.newReviewNote, status: "NEED_FIX" });
          renderPageRevItems();
        }
        await saveCurrentProject();
      },
      {
        pageTitle: pageTitleText,
        hasPrev: activePageIdx > 0,
        hasNext: activePageIdx < totalPages - 1,
        getPhraseBank: () => customPhraseBank,
        onOpenPhraseManager: () => {
          const next = prompt("快速新增一條審圖快捷短語（將同步雲端）：");
          if (next && next.trim()) {
            customPhraseBank.unshift({ cat: "自訂常用", text: next.trim() });
            saveCustomPhraseBank();
          }
        },
        onPrev: () => { if (activePageIdx > 0) saveAndRun(() => { activePageIdx--; renderWorkspace(); }); },
        onNext: () => { if (activePageIdx < totalPages - 1) saveAndRun(() => { activePageIdx++; renderWorkspace(); }); }
      }
    );
  };

  const whiteBtn = document.getElementById("btn-toggle-white-bg");
  whiteBtn.onclick = () => {
    if (!activeCanvasInstance) {
      page.sitePhotoUrl = createBlankWhiteDataUrl();
      showMeasure();
      return;
    }
    const isWhite = activeCanvasInstance.toggleWhiteBackground();
    whiteBtn.style.background = isWhite ? "#FEF08A" : "#F8FAFC";
    whiteBtn.textContent = isWhite ? "🖼️ 還原底圖" : "📄 白底";
  };

  document.getElementById("up-site-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div style="color:#475569; text-align:center; padding:50px;">正在壓縮並同步底圖至雲端...</div>`;
    const res = await uploadMediaToCloud(currentProject.id, page.id, file);
    page.sitePhotoUrl = res.imageData;
    memoryPhotoCache.set(page.id, res.imageData);
    await saveCurrentProject();
    showMeasure();
  };

  await ensureSinglePagePhoto(currentProject, page);
  showMeasure();
}
