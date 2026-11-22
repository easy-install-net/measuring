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
  const qActive = query(collection(db, PROJ_COL), where("archived", "!=", true));
  const snap = await getDocs(qActive);
  const raw = [];
  snap.forEach(d => raw.push({ id: d.id, ...d.data() }));
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
        <button id="btn-space-sort-toggle" title
