import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "./config/firebase-init.js";
import { loadMasterDict } from "./config/master-dict.js";
import { checkBrowserCompatibility, watchAuth, renderLoginView } from "./core/auth.js";
import { uploadMediaToCloud } from "./core/image-upload.js";
import {
  idbSaveProject, idbGetAllProjects, idbDeleteProject,
  idbSaveMedia, idbGetMedia, idbSetKV, idbGetKV,
  idbEnqueueSync, idbGetSyncQueue, idbRemoveSyncTask
} from "./core/offline-db.js";
import { MeasureCanvas } from "./modules/measure-canvas.js";
import { renderReportBuilder, renderPublicShareReportView } from "./modules/report-builder.js";

const PROJ_COL = (COLLECTIONS && COLLECTIONS.PROJECTS) || "measuring_projects";
const MEDIA_COL = (COLLECTIONS && COLLECTIONS.MEDIA) || "measuring_media";
const SETTINGS_COL = "measuring_settings";
const CLOUD_DICT_DOC_ID = "measuring_cloud_dictionary_v1";
const LOCAL_ACTIVE_KEY = "measuring_local_active_projects_v2";
const HIDDEN_STORAGE_KEY = "measuring_hidden_proj_ids";
const OFFLINE_AUTH_FLAG = "measuring_offline_auth_ok_v1";

const root = document.getElementById("app-root");
let masterDict = null;
let currentProject = null;
let activePageIdx = -1;
let compareSpaceName = null;
let filterSpace = "ALL";
let filterCategory = "ALL";
let showArchivedInSummon = false;
let summonSearchText = "";
let cachedCloudActiveList = null;
let cachedCloudArchivedList = null;
let openContactProjId = null;
let activeCanvasInstance = null;
let overviewRenderGeneration = 0;

let cloudStampGroups = [];
let cloudPhraseBank = [];
let cloudPresetSpaces = ["總圖", "玄關", "客廳", "飯廳", "廚房", "主人房", "兒童房", "工人房", "浴室", "露台"];
const memoryPhotoCache = new Map();

const CORE_CATEGORIES = ["度尺圖", "平面圖", "繪圖", "效果圖"];
const CAT_RANK = { "平面圖": 1, "度尺圖": 2, "繪圖": 3, "效果圖": 4 };

function normalizePageCategory(p) {
  const raw = String(p?.docTypeLabel || p?.docType || "").trim();
  if (raw === "平面圖" || raw === "plan") return "平面圖";
  if (raw === "效果圖" || raw === "render") return "效果圖";
  if (raw === "繪圖" || raw === "立體圖" || raw === "詳圖" || raw === "3d" || raw === "detail") return "繪圖";
  return "度尺圖";
}

const REVIEW_STATUS_META = {
  NEED_FIX:   { label: "❌ 需改",     bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5", badgeBg: "#DC2626", badgeText: "#FFFFFF" },
  SITE_CHECK: { label: "⚠️ 再核對",   bg: "#FEF3C7", text: "#92400E", border: "#FCD34D", badgeBg: "#D97706", badgeText: "#FFFFFF" },
  NEED_INFO:  { label: "📌 待補資料", bg: "#DBEAFE", text: "#1E40AF", border: "#93C5FD", badgeBg: "#2563EB", badgeText: "#FFFFFF" },
  OK:         { label: "✅ 確認",     bg: "#DCFCE7", text: "#166534", border: "#86EFAC", badgeBg: "#059669", badgeText: "#FFFFFF" }
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
  document.querySelectorAll("header, nav, .navbar, .topbar, h1, a, span, strong, div, button").forEach(el => {
    if (el.children.length === 0 && el.textContent) {
      const txt = el.textContent.trim();
      if (txt === "MEASURING") el.textContent = "度尺批改";
      else if (txt === "登入" && (el.tagName === "BUTTON" || el.tagName === "A")) el.style.display = "none";
    }
  });
}
applyBrandTitle();

function updateNetworkBanner(extraMsg = "") {
  let bar = document.getElementById("offline-status-pill");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "offline-status-pill";
    bar.style.cssText = "position:fixed; bottom:10px; left:10px; z-index:1100; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:800; box-shadow:0 4px 12px rgba(0,0,0,0.18); pointer-events:none; transition:all 0.2s;";
    document.body.appendChild(bar);
  }
  const isOnline = navigator.onLine;
  if (isOnline) {
    bar.style.background = "#ECFDF5";
    bar.style.color = "#065F46";
    bar.style.border = "1px solid #6EE7B7";
    bar.textContent = extraMsg || "🟢 線上已連線（離線快取就緒）";
  } else {
    bar.style.background = "#FEF3C7";
    bar.style.color = "#92400E";
    bar.style.border = "1.5px solid #F59E0B";
    bar.textContent = extraMsg || "🟠 離線模式中（所有修改與拍照自動存本機）";
  }
}

async function flushOfflineSyncQueue() {
  if (!navigator.onLine) {
    updateNetworkBanner();
    return;
  }
  const tasks = await idbGetSyncQueue();
  if (!tasks.length) {
    updateNetworkBanner();
    return;
  }
  updateNetworkBanner(`🔄 恢復連線，正在背景同步 ${tasks.length} 項離線資料...`);
  for (const t of tasks) {
    try {
      if (t.type === "PROJECT") {
        await setDoc(doc(db, PROJ_COL, t.targetId), t.payload);
      } else if (t.type === "MEDIA") {
        await setDoc(doc(db, MEDIA_COL, t.targetId), t.payload);
      } else if (t.type === "DICT") {
        await setDoc(doc(db, SETTINGS_COL, CLOUD_DICT_DOC_ID), t.payload);
      }
      await idbRemoveSyncTask(t.queueId);
    } catch (_) {}
  }
  const remain = await idbGetSyncQueue();
  updateNetworkBanner(remain.length ? `🟠 尚有 ${remain.length} 項待同步` : "✅ 離線資料已全部同步上雲");
}

window.addEventListener("online", () => flushOfflineSyncQueue());
window.addEventListener("offline", () => updateNetworkBanner());

function cleanProjectTitle(name) {
  return String(name || "").replace(/\s*\(\d{5,8}\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function getHiddenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || "[]")); } catch (_) { return new Set(); }
}
function saveHiddenIds(setObj) { localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(setObj))); }

function getLocalProjects() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_ACTIVE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (_) { return []; }
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
  idbSaveProject(proj).catch(() => {});
  const list = getLocalProjects();
  const cleanSlim = { ...proj, pages: (proj.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" })) };
  const idx = list.findIndex(x => x.id === proj.id);
  if (proj.archived === true) { if (idx >= 0) list.splice(idx, 1); }
  else if (idx >= 0) list[idx] = cleanSlim;
  else list.unshift(cleanSlim);
  saveLocalProjects(list);
}

function removeLocalProjectById(pid) {
  idbDeleteProject(pid).catch(() => {});
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseMapQueryFromTitle(title) {
  return encodeURIComponent(`香港 ${cleanProjectTitle(title).replace(/傢俬圖|尺吋圖|平面圖|度尺/g, "").trim()}`);
}

function formatWhatsAppUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits.length === 8 ? `852${digits}` : digits}`;
}

function dedupProjects(rawProjects) {
  const dedupMap = new Map();
  rawProjects.forEach(p => {
    const key = p.legacySourceId ? `SRC_${p.legacySourceId}` : `NAME_${cleanProjectTitle(p.name)}`;
    const existing = dedupMap.get(key);
    if (!existing) dedupMap.set(key, p);
    else {
      const scoreNew = countProjectAnnotations(p) * 1000000 + (p.updatedAt || 0);
      const scoreOld = countProjectAnnotations(existing) * 1000000 + (existing.updatedAt || 0);
      if (scoreNew > scoreOld) dedupMap.set(key, p);
    }
  });
  return Array.from(dedupMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function loadCloudDictionaryFromDB() {
  const cachedDict = await idbGetKV("cloud_dict");
  if (cachedDict) {
    if (Array.isArray(cachedDict.stampGroups)) cloudStampGroups = cachedDict.stampGroups;
    if (Array.isArray(cachedDict.phraseBank)) cloudPhraseBank = cachedDict.phraseBank;
    if (Array.isArray(cachedDict.presetSpaces) && cachedDict.presetSpaces.length) cloudPresetSpaces = cachedDict.presetSpaces;
  }
  if (!navigator.onLine) {
    const seed = getSeedTemplatesForDB();
    if (!cloudStampGroups.length) cloudStampGroups = seed.stampGroups;
    if (!cloudPhraseBank.length) cloudPhraseBank = seed.phraseBank;
    return;
  }
  try {
    const snap = await getDoc(doc(db, SETTINGS_COL, CLOUD_DICT_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.stampGroups)) cloudStampGroups = data.stampGroups;
      if (Array.isArray(data.phraseBank)) cloudPhraseBank = data.phraseBank;
      if (Array.isArray(data.presetSpaces) && data.presetSpaces.length) cloudPresetSpaces = data.presetSpaces;
    }
    const seed = getSeedTemplatesForDB();
    let needAutoSave = false;
    if (!cloudStampGroups.length) {
      cloudStampGroups = (masterDict?.stampGroups?.length) ? masterDict.stampGroups : seed.stampGroups;
      needAutoSave = true;
    }
    if (!cloudPhraseBank.length) {
      cloudPhraseBank = seed.phraseBank;
      needAutoSave = true;
    }
    await idbSetKV("cloud_dict", { stampGroups: cloudStampGroups, phraseBank: cloudPhraseBank, presetSpaces: cloudPresetSpaces });
    if (needAutoSave) await saveCloudDictionaryToDB();
  } catch (_) {}
}

async function saveCloudDictionaryToDB() {
  const payload = {
    stampGroups: cloudStampGroups,
    phraseBank: cloudPhraseBank,
    presetSpaces: cloudPresetSpaces,
    updatedAt: Date.now()
  };
  await idbSetKV("cloud_dict", payload);
  if (!navigator.onLine) {
    await idbEnqueueSync({ type: "DICT", targetId: CLOUD_DICT_DOC_ID, payload });
    return;
  }
  try {
    await setDoc(doc(db, SETTINGS_COL, CLOUD_DICT_DOC_ID), payload);
  } catch (_) {
    await idbEnqueueSync({ type: "DICT", targetId: CLOUD_DICT_DOC_ID, payload });
  }
}

function getSeedTemplatesForDB() {
  return {
    stampGroups: [
      { name: "電掣", items: ["13A單蘇", "13A孖蘇", "燈掣", "雙控掣", "數據掣", "電視掣", "冷氣掣", "曲架掣", "電箱"] },
      { name: "水煤", items: ["冷水喉", "熱水喉", "去水位", "地台去水", "煤氣掣", "煤氣錶"] },
      { name: "收口/結構", items: ["收口條", "見光板", "石膏線", "燈槽", "假天花底", "橫樑陣位", "柱位", "暗門", "地腳線"] }
    ],
    phraseBank: [
      { cat: "搬運收口", text: "⚠️ 超出2300mm電梯上限，必須標註分件接駁" },
      { cat: "搬運收口", text: "⚠️ 核對大廈後樓梯轉角能否搬運" },
      { cat: "搬運收口", text: "⚠️ 兩牆之間做死數(0mm)，確認現場垂直度" },
      { cat: "搬運收口", text: "⚠️ 頂部無留20mm收口條，天花不平會出現大小縫" },
      { cat: "搬運收口", text: "⚠️ 貼牆櫃背需切15×100mm缺口避原裝地腳線" },
      { cat: "搬運收口", text: "⚠️ 踢腳高度需拉平全屋統一地腳線" },
      { cat: "搬運收口", text: "⚠️ 走廊剩餘通道<750mm，影響通行及搬運" },
      { cat: "搬運收口", text: "⚠️ 懸空櫃離地50-100mm尷尬位，掃地機進不去" },
      { cat: "搬運收口", text: "🚨 石膏板/空心牆無法直接掛重型吊櫃" },
      { cat: "搬運收口", text: "⚠️ 櫃體撞陣柱，需做切角或降高避讓" },
      { cat: "門窗碰撞", text: "🚨 趟門衣櫃總深不足580mm，扣除路軌掛衫關不上門" },
      { cat: "門窗碰撞", text: "⚠️ 掩門高>2000mm易彎曲，需加裝暗藏拉直器" },
      { cat: "門窗碰撞", text: "⚠️ 拍門器需留足3mm回彈縫否則彈不出" },
      { cat: "門窗碰撞", text: "🚨 掩門內抽側板需加25mm墊厚條避門鉸" },
      { cat: "門窗碰撞", text: "🚨 L型轉角兩門相交需加40×40mm收口柱防互撞" },
      { cat: "門窗碰撞", text: "⚠️ 靠床掩門下段會撞床頭櫃，建議改上下分段門" },
      { cat: "門窗碰撞", text: "🚨 油壓床板向上揭起時會撞到吸頂燈或冷氣機" },
      { cat: "門窗碰撞", text: "⚠️ 玄關鞋櫃距大門框<120mm，開門門鎖會撞側板" },
      { cat: "門窗碰撞", text: "⚠️ 書枱/餐櫃後方淨空<750mm，椅子無法拉出轉身" },
      { cat: "門窗碰撞", text: "⚠️ 浴屏外開掩門打開時會撞到浴室櫃" },
      { cat: "水電冷氣", text: "🚨 插蘇位被固定層板/抽屜軌擋住無法插電" },
      { cat: "水電冷氣", text: "⚠️ 牆身燈掣被櫃身遮擋，需改位或開側板孔" },
      { cat: "水電冷氣", text: "⚠️ 電箱藏櫃內，內部層板必須做活動可拆" },
      { cat: "水電冷氣", text: "⚠️ 掛牆電視至地櫃需設50mm暗藏穿線管開孔" },
      { cat: "水電冷氣", text: "🚨 高櫃距分體冷氣頂<150mm，遮擋迴風會滴水" },
      { cat: "水電冷氣", text: "⚠️ 背板貼牆有冷氣去水喉，需開凹槽避讓防壓爆" },
      { cat: "水電冷氣", text: "🚨 LED燈帶火牛必須放活動層板或可拆蓋板內檢修" },
      { cat: "水電冷氣", text: "🚨 高櫃頂距消防花灑頭<500mm，違反安全距離" },
      { cat: "水電冷氣", text: "🚨 煤氣櫃門必須設通風百葉孔及檢修空間" },
      { cat: "水電冷氣", text: "⚠️ 床褥或軟包高度會遮擋牆身床頭充電插蘇" },
      { cat: "廚浴電器", text: "🚨 雪櫃左右及頂部各需留30mm散熱縫" },
      { cat: "廚浴電器", text: "🚨 雪櫃貼牆側需留≥50mm門縫收口才能開90°門" },
      { cat: "廚浴電器", text: "🚨 焗爐/蒸焗爐櫃身淨深需≥電器深度+60mm" },
      { cat: "廚浴電器", text: "🚨 洗衣機櫃淨深需≥機身深度+80mm容納來去水喉" },
      { cat: "廚浴電器", text: "⚠️ 抽油煙機吊櫃頂需設假身包管遮擋排氣喉" },
      { cat: "廚浴電器", text: "🚨 內開廚房窗打開會撞到星盆高身水龍頭" },
      { cat: "廚浴電器", text: "🚨 星盆櫃層板需預留U型去水隔氣喉缺口" },
      { cat: "廚浴電器", text: "🚨 廚櫃星盆櫃/浴室櫃潮濕區必須用防水夾板" },
      { cat: "廚浴電器", text: "🚨 浴室櫃不可木板直接落地，需離地≥250mm或防水腳" },
      { cat: "廚浴電器", text: "⚠️ 鏡櫃底距洗手盆面<350mm，外開掩門會撞龍頭" }
    ]
  };
}

function openCloudDictModal(initialTab = "STAMP", onCloseRefresh = null) {
  let activeTab = initialTab;
  const existing = document.getElementById("cloud-dict-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "cloud-dict-modal";
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; z-index:1200; padding:12px;";

  const renderModalContent = () => {
    overlay.innerHTML = `
      <div style="width:min(540px, 96vw); max-height:86vh; background:#FFF; border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:0 20px 40px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:8px;">
          <strong style="font-size:15px; color:#0F172A;">⚙️ 雲端預設空間與詞庫管理</strong>
          <button id="cdm-close" style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:6px; padding:3px 9px; font-size:12px; font-weight:700; cursor:pointer;">完成關閉</button>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; gap:5px; flex-wrap:wrap;">
            <button id="cdm-tab-space" style="padding:4px 10px; border-radius:999px; font-size:12px; font-weight:800; cursor:pointer; border:1px solid ${activeTab === "SPACE" ? "#059669" : "#CBD5E1"}; background:${activeTab === "SPACE" ? "#059669" : "#F8FAFC"}; color:${activeTab === "SPACE" ? "#FFF" : "#334155"};">
              預設空間 (${cloudPresetSpaces.length})
            </button>
            <button id="cdm-tab-stamp" style="padding:4px 10px; border-radius:999px; font-size:12px; font-weight:800; cursor:pointer; border:1px solid ${activeTab === "STAMP" ? "#0F172A" : "#CBD5E1"}; background:${activeTab === "STAMP" ? "#0F172A" : "#F8FAFC"}; color:${activeTab === "STAMP" ? "#FFF" : "#334155"};">
              現場詞庫 (${cloudStampGroups.reduce((a, g) => a + (g.items || []).length, 0)})
            </button>
            <button id="cdm-tab-phrase" style="padding:4px 10px; border-radius:999px; font-size:12px; font-weight:800; cursor:pointer; border:1px solid ${activeTab === "PHRASE" ? "#2563EB" : "#CBD5E1"}; background:${activeTab === "PHRASE" ? "#2563EB" : "#F8FAFC"}; color:${activeTab === "PHRASE" ? "#FFF" : "#334155"};">
              批改短語庫 (${cloudPhraseBank.length})
            </button>
          </div>
          <button id="cdm-seed-btn" style="background:#FEF3C7; color:#92400E; border:1px solid #F59E0B; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:700; cursor:pointer;">
            匯入範本至雲端DB
          </button>
        </div>

        <div id="cdm-body" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;"></div>
      </div>
    `;

    overlay.querySelector("#cdm-close").onclick = () => {
      overlay.remove();
      if (typeof onCloseRefresh === "function") onCloseRefresh();
    };
    overlay.querySelector("#cdm-tab-space").onclick = () => { activeTab = "SPACE"; renderModalContent(); };
    overlay.querySelector("#cdm-tab-stamp").onclick = () => { activeTab = "STAMP"; renderModalContent(); };
    overlay.querySelector("#cdm-tab-phrase").onclick = () => { activeTab = "PHRASE"; renderModalContent(); };
    overlay.querySelector("#cdm-seed-btn").onclick = async () => {
      if (!confirm("確定將標準「電掣/水煤/收口詞庫」及「40條審圖短語」寫入雲端與本機資料庫嗎？")) return;
      const seed = getSeedTemplatesForDB();
      if (!cloudStampGroups.length) cloudStampGroups = seed.stampGroups;
      if (!cloudPhraseBank.length) cloudPhraseBank = seed.phraseBank;
      await saveCloudDictionaryToDB();
      renderModalContent();
    };

    const bodyEl = overlay.querySelector("#cdm-body");
    if (activeTab === "SPACE") {
      bodyEl.innerHTML = `
        <div style="display:flex; gap:5px;">
          <input type="text" id="cdm-sp-word" placeholder="輸入新預設空間（如：衣帽間 / 儲物房 / 工人廁）" style="flex:1; padding:6px 8px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px;" />
          <button id="cdm-sp-add" class="btn-solid btn-sm" style="background:#059669; border-color:#059669;">+ 新增空間</button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; padding:6px 0;">
          ${cloudPresetSpaces.map((sp, idx) => `
            <span style="display:inline-flex; align-items:center; gap:5px; background:#F0FDF4; border:1px solid #86EFAC; color:#166534; border-radius:999px; padding:3px 10px; font-size:12px; font-weight:700;">
              ${sp}
              <button class="cdm-del-sp" data-spidx="${idx}" style="background:none; border:none; color:#15803D; cursor:pointer; padding:0; font-weight:800;">✕</button>
            </span>
          `).join("")}
        </div>
      `;
      bodyEl.querySelector("#cdm-sp-add").onclick = async () => {
        const w = (bodyEl.querySelector("#cdm-sp-word").value || "").trim();
        if (!w || cloudPresetSpaces.includes(w)) return;
        cloudPresetSpaces.push(w);
        await saveCloudDictionaryToDB();
        renderModalContent();
      };
      bodyEl.querySelectorAll(".cdm-del-sp").forEach(b => {
        b.onclick = async () => {
          cloudPresetSpaces.splice(Number(b.dataset.spidx), 1);
          await saveCloudDictionaryToDB();
          renderModalContent();
        };
      });
    } else if (activeTab === "STAMP") {
      bodyEl.innerHTML = `
        <div style="display:flex; gap:5px; flex-wrap:wrap;">
          <input type="text" id="cdm-st-cat" placeholder="分類（如：電掣 / 水煤 / 收口）" style="width:130px; padding:5px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px;" />
          <input type="text" id="cdm-st-word" placeholder="新詞彙（如：13A單蘇 / 煤氣錶）" style="flex:1; min-width:140px; padding:5px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px;" />
          <button id="cdm-st-add" class="btn-solid btn-sm">+ 存入詞庫</button>
        </div>
        ${cloudStampGroups.map((g, gIdx) => `
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:13px; color:#0F172A;">${g.name}</strong>
              <button class="cdm-del-group" data-gidx="${gIdx}" style="background:none; border:none; color:#DC2626; font-size:11px; cursor:pointer;">刪除整組</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:5px;">
              ${(g.items || []).map((w, wIdx) => `
                <span style="display:inline-flex; align-items:center; gap:4px; background:#FFF; border:1px solid #CBD5E1; border-radius:5px; padding:2px 7px; font-size:12px;">
                  ${w}
                  <button class="cdm-del-word" data-gidx="${gIdx}" data-widx="${wIdx}" style="background:none; border:none; color:#94A3B8; cursor:pointer; padding:0;">✕</button>
                </span>
              `).join("")}
            </div>
          </div>
        `).join("") || `<div style="font-size:12px; color:#64748B; padding:10px;">目前沒有詞彙，可手動新增或點上方「匯入範本至雲端DB」。</div>`}
      `;

      bodyEl.querySelector("#cdm-st-add").onclick = async () => {
        const cat = (bodyEl.querySelector("#cdm-st-cat").value || "常用").trim();
        const word = (bodyEl.querySelector("#cdm-st-word").value || "").trim();
        if (!word) return;
        let grp = cloudStampGroups.find(x => x.name === cat);
        if (!grp) { grp = { name: cat, items: [] }; cloudStampGroups.push(grp); }
        if (!grp.items.includes(word)) grp.items.push(word);
        await saveCloudDictionaryToDB();
        renderModalContent();
      };
      bodyEl.querySelectorAll(".cdm-del-word").forEach(b => {
        b.onclick = async () => {
          cloudStampGroups[Number(b.dataset.gidx)].items.splice(Number(b.dataset.widx), 1);
          await saveCloudDictionaryToDB();
          renderModalContent();
        };
      });
      bodyEl.querySelectorAll(".cdm-del-group").forEach(b => {
        b.onclick = async () => {
          cloudStampGroups.splice(Number(b.dataset.gidx), 1);
          await saveCloudDictionaryToDB();
          renderModalContent();
        };
      });
    } else {
      bodyEl.innerHTML = `
        <div style="display:flex; gap:5px; flex-wrap:wrap;">
          <input type="text" id="cdm-ph-cat" placeholder="分類（如：搬運收口）" style="width:110px; padding:5px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px;" />
          <input type="text" id="cdm-ph-txt" placeholder="新批改短語..." style="flex:1; min-width:150px; padding:5px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px;" />
          <button id="cdm-ph-add" class="btn-solid btn-sm">+ 存入詞庫</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${cloudPhraseBank.map((p, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:5px 8px; font-size:12px;">
              <div>
                <span style="font-size:10px; background:#DBEAFE; color:#1D4ED8; padding:1px 5px; border-radius:3px; font-weight:700; margin-right:5px;">${p.cat || "常用"}</span>
                <span>${p.text}</span>
              </div>
              <div style="display:flex; gap:4px;">
                <button class="cdm-ph-edit" data-idx="${idx}" style="background:none; border:none; color:#475569; cursor:pointer; font-size:11px;">改</button>
                <button class="cdm-ph-del" data-idx="${idx}" style="background:none; border:none; color:#DC2626; cursor:pointer; font-size:12px;">✕</button>
              </div>
            </div>
          `).join("") || `<div style="font-size:12px; color:#64748B; padding:10px;">目前沒有短語，可手動新增或點上方「匯入範本至雲端DB」。</div>`}
        </div>
      `;

      bodyEl.querySelector("#cdm-ph-add").onclick = async () => {
        const cat = (bodyEl.querySelector("#cdm-ph-cat").value || "常用").trim();
        const txt = (bodyEl.querySelector("#cdm-ph-txt").value || "").trim();
        if (!txt) return;
        cloudPhraseBank.unshift({ cat, text: txt });
        await saveCloudDictionaryToDB();
        renderModalContent();
      };
      bodyEl.querySelectorAll(".cdm-ph-edit").forEach(b => {
        b.onclick = async () => {
          const idx = Number(b.dataset.idx);
          const next = prompt("修改短語：", cloudPhraseBank[idx].text);
          if (next && next.trim()) {
            cloudPhraseBank[idx].text = next.trim();
            await saveCloudDictionaryToDB();
            renderModalContent();
          }
        };
      });
      bodyEl.querySelectorAll(".cdm-ph-del").forEach(b => {
        b.onclick = async () => {
          cloudPhraseBank.splice(Number(b.dataset.idx), 1);
          await saveCloudDictionaryToDB();
          renderModalContent();
        };
      });
    }
  };

  document.body.appendChild(overlay);
  renderModalContent();
}

function openQuickReassignModal(page, projectSpaces, onUpdated) {
  const existing = document.getElementById("quick-reassign-modal");
  if (existing) existing.remove();

  let selectedCat = normalizePageCategory(page);
  let selectedSpace = page.space || "未標空間";
  const allChoices = [...new Set([...projectSpaces, ...cloudPresetSpaces])].filter(s => s && s !== "未標空間");

  const overlay = document.createElement("div");
  overlay.id = "quick-reassign-modal";
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.52); display:flex; align-items:center; justify-content:center; z-index:1250; padding:12px;";

  const renderBox = () => {
    overlay.innerHTML = `
      <div style="width:min(400px, 94vw); background:#FFF; border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:12px; box-shadow:0 20px 40px rgba(0,0,0,0.28);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:6px;">
          <strong style="font-size:14px; color:#0F172A;">修改 ${page.pageNum || ""} 分類與所屬空間</strong>
          <button id="qrm-close" style="background:none; border:none; color:#64748B; font-size:15px; cursor:pointer;">✕</button>
        </div>

        <div>
          <div style="font-size:11px; font-weight:800; color:#475569; margin-bottom:5px;">1. 點選圖紙分類</div>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
            ${CORE_CATEGORIES.map(c => `
              <button type="button" class="qrm-cat-btn" data-qcat="${c}"
                      style="padding:6px 4px; border-radius:7px; font-size:12px; font-weight:800; cursor:pointer; border:1.5px solid ${selectedCat === c ? "#2563EB" : "#CBD5E1"}; background:${selectedCat === c ? "#DBEAFE" : "#F8FAFC"}; color:${selectedCat === c ? "#1D4ED8" : "#334155"};">
                ${c}
              </button>
            `).join("")}
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <span style="font-size:11px; font-weight:800; color:#475569;">2. 點選所屬空間</span>
            <button type="button" id="qrm-manage-sp" style="background:none; border:none; color:#2563EB; font-size:11px; font-weight:700; cursor:pointer;">⚙️ 管理預設空間</button>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px; max-height:190px; overflow-y:auto;">
            ${allChoices.map(sp => `
              <button type="button" class="qrm-sp-btn" data-qsp="${sp}"
                      style="padding:5px 11px; border-radius:999px; font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid ${selectedSpace === sp ? "#0F172A" : "#CBD5E1"}; background:${selectedSpace === sp ? "#0F172A" : "#FFF"}; color:${selectedSpace === sp ? "#FFF" : "#1E293B"};">
                ${sp}
              </button>
            `).join("")}
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:6px; border-top:1px solid #E2E8F0; padding-top:8px;">
          <button id="qrm-cancel" class="btn-outline btn-sm">取消</button>
          <button id="qrm-save" class="btn-solid btn-sm">確定套用</button>
        </div>
      </div>
    `;

    overlay.querySelector("#qrm-close").onclick = () => overlay.remove();
    overlay.querySelector("#qrm-cancel").onclick = () => overlay.remove();
    overlay.querySelector("#qrm-manage-sp").onclick = () => {
      overlay.remove();
      openCloudDictModal("SPACE", () => openQuickReassignModal(page, projectSpaces, onUpdated));
    };
    overlay.querySelectorAll(".qrm-cat-btn").forEach(b => {
      b.onclick = () => { selectedCat = b.dataset.qcat; renderBox(); };
    });
    overlay.querySelectorAll(".qrm-sp-btn").forEach(b => {
      b.onclick = () => { selectedSpace = b.dataset.qsp; renderBox(); };
    });
    overlay.querySelector("#qrm-save").onclick = async () => {
      page.docTypeLabel = selectedCat;
      page.space = selectedSpace;
      page.title = `${selectedSpace} · ${selectedCat}`;
      overlay.remove();
      await saveCurrentProject();
      if (typeof onUpdated === "function") onUpdated();
    };
  };

  document.body.appendChild(overlay);
  renderBox();
}

function guessSpaceAndCategoryFromFilename(filename, availableSpaces) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  let detectedCat = "度尺圖";
  if (/平面/.test(base)) detectedCat = "平面圖";
  else if (/效果|渲染|3D圖/i.test(base)) detectedCat = "效果圖";
  else if (/繪圖|立體|詳圖|立面|大樣/.test(base)) detectedCat = "繪圖";
  else if (/度尺|實測|現場/.test(base)) detectedCat = "度尺圖";

  let detectedSpace = "";
  const sortedSpaces = [...availableSpaces].sort((a, b) => b.length - a.length);
  for (const sp of sortedSpaces) {
    if (sp && sp !== "未標空間" && base.includes(sp)) {
      detectedSpace = sp;
      break;
    }
  }
  return { detectedSpace, detectedCat, cleanBase: base };
}

function openBatchUploadModal(projectSpaces, onCompleted) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.multiple = true;

  picker.onchange = () => {
    const files = Array.from(picker.files || []);
    if (!files.length) return;

    const allSpaceOptions = [...new Set([...projectSpaces, ...cloudPresetSpaces])].filter(s => s && s !== "未標空間");
    const defaultSpace = allSpaceOptions[0] || "總圖";

    const items = files.map((file, idx) => {
      const { detectedSpace, detectedCat } = guessSpaceAndCategoryFromFilename(file.name, allSpaceOptions);
      return {
        id: `batch_${Date.now()}_${idx}`,
        file,
        previewUrl: URL.createObjectURL(file),
        space: detectedSpace || defaultSpace,
        category: detectedCat
      };
    });

    const existing = document.getElementById("batch-upload-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "batch-upload-modal";
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.62); display:flex; align-items:center; justify-content:center; z-index:1300; padding:10px;";

    const cleanupUrls = () => items.forEach(it => URL.revokeObjectURL(it.previewUrl));

    const renderModal = () => {
      overlay.innerHTML = `
        <div style="width:min(760px, 97vw); max-height:90vh; background:#FFFFFF; border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:0 20px 45px rgba(0,0,0,0.35);">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:8px;">
            <div>
              <strong style="font-size:16px; color:#0F172A;">📤 批量上底圖（已選 ${items.length} 張）</strong>
              <div style="font-size:11px; color:#64748B; margin-top:2px;">已自動識別檔名中的空間與分類，可逐張微調或一鍵統一套用</div>
            </div>
            <button type="button" id="bum-close" class="btn-outline btn-sm">取消</button>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:7px 9px;">
            <span style="font-size:12px; font-weight:800; color:#334155;">全部統一改為：</span>
            <select id="bum-all-space" style="padding:4px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700;">
              ${allSpaceOptions.map(sp => `<option value="${sp}">${sp}</option>`).join("")}
            </select>
            <button type="button" id="bum-apply-all-space" class="btn-outline btn-sm" style="font-size:11px;">套用空間至全部</button>

            <select id="bum-all-cat" style="padding:4px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700; margin-left:4px;">
              ${CORE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}
            </select>
            <button type="button" id="bum-apply-all-cat" class="btn-outline btn-sm" style="font-size:11px;">套用分類至全部</button>

            <button type="button" id="bum-add-more" class="btn-outline btn-sm" style="margin-left:auto; color:#1D4ED8; border-color:#93C5FD; font-weight:800;">+ 繼續加選圖片</button>
          </div>

          <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;">
            ${items.map((it, idx) => `
              <div style="display:flex; align-items:center; gap:8px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:6px 8px; flex-wrap:wrap;">
                <img src="${it.previewUrl}" style="width:54px; height:42px; object-fit:contain; border:1px solid #E2E8F0; border-radius:4px; background:#F8FAFC; flex-shrink:0;" />
                <div style="flex:1; min-width:130px; overflow:hidden;">
                  <div style="font-size:12px; font-weight:800; color:#0F172A; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    #${idx + 1} · ${it.file.name}
                  </div>
                  <div style="font-size:10px; color:#64748B;">${(it.file.size / 1024).toFixed(0)} KB</div>
                </div>

                <select class="bum-item-space" data-bidx="${idx}" style="padding:4px 6px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700; color:#0F172A;">
                  ${allSpaceOptions.map(sp => `<option value="${sp}" ${it.space === sp ? "selected" : ""}>${sp}</option>`).join("")}
                </select>

                <div style="display:inline-flex; gap:3px;">
                  ${CORE_CATEGORIES.map(c => `
                    <button type="button" class="bum-item-cat" data-bidx="${idx}" data-bcat="${c}"
                            style="padding:3px 6px; border-radius:5px; font-size:11px; font-weight:800; cursor:pointer; border:1px solid ${it.category === c ? "#2563EB" : "#CBD5E1"}; background:${it.category === c ? "#DBEAFE" : "#F8FAFC"}; color:${it.category === c ? "#1D4ED8" : "#475569"};">
                      ${c}
                    </button>
                  `).join("")}
                </div>

                <button type="button" class="bum-item-del" data-bidx="${idx}" title="移除此張"
                        style="background:none; border:none; color:#DC2626; font-size:14px; font-weight:800; cursor:pointer; padding:2px 5px;">✕</button>
              </div>
            `).join("")}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #E2E8F0; padding-top:8px; gap:8px;">
            <span id="bum-progress-text" style="font-size:12px; font-weight:700; color:#059669;"></span>
            <div style="display:flex; gap:6px;">
              <button type="button" id="bum-cancel-btn" class="btn-outline btn-sm">取消</button>
              <button type="button" id="bum-confirm-btn" class="btn-solid btn-sm" style="background:#0F172A; border-color:#0F172A;">
                ✅ 確認批量匯入（${items.length} 張）
              </button>
            </div>
          </div>
        </div>
      `;

      const closeAll = () => {
        cleanupUrls();
        overlay.remove();
      };
      overlay.querySelector("#bum-close").onclick = closeAll;
      overlay.querySelector("#bum-cancel-btn").onclick = closeAll;

      overlay.querySelector("#bum-apply-all-space").onclick = () => {
        const val = overlay.querySelector("#bum-all-space").value;
        items.forEach(it => { it.space = val; });
        renderModal();
      };

      overlay.querySelector("#bum-apply-all-cat").onclick = () => {
        const val = overlay.querySelector("#bum-all-cat").value;
        items.forEach(it => { it.category = val; });
        renderModal();
      };

      overlay.querySelector("#bum-add-more").onclick = () => {
        const extraPicker = document.createElement("input");
        extraPicker.type = "file";
        extraPicker.accept = "image/*";
        extraPicker.multiple = true;
        extraPicker.onchange = () => {
          const extraFiles = Array.from(extraPicker.files || []);
          extraFiles.forEach((f, i) => {
            const { detectedSpace, detectedCat } = guessSpaceAndCategoryFromFilename(f.name, allSpaceOptions);
            items.push({
              id: `batch_${Date.now()}_${items.length}_${i}`,
              file: f,
              previewUrl: URL.createObjectURL(f),
              space: detectedSpace || defaultSpace,
              category: detectedCat
            });
          });
          renderModal();
        };
        extraPicker.click();
      };

      overlay.querySelectorAll(".bum-item-space").forEach(sel => {
        sel.onchange = () => {
          items[Number(sel.dataset.bidx)].space = sel.value;
        };
      });

      overlay.querySelectorAll(".bum-item-cat").forEach(btn => {
        btn.onclick = () => {
          items[Number(btn.dataset.bidx)].category = btn.dataset.bcat;
          renderModal();
        };
      });

      overlay.querySelectorAll(".bum-item-del").forEach(btn => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.bidx);
          URL.revokeObjectURL(items[idx].previewUrl);
          items.splice(idx, 1);
          if (!items.length) closeAll();
          else renderModal();
        };
      });

      overlay.querySelector("#bum-confirm-btn").onclick = async () => {
        if (!items.length) return;
        const confirmBtn = overlay.querySelector("#bum-confirm-btn");
        const progText = overlay.querySelector("#bum-progress-text");
        confirmBtn.disabled = true;

        if (!Array.isArray(currentProject.pages)) currentProject.pages = [];
        const baseTs = Date.now();

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          progText.textContent = `⏳ 正在儲存第 ${i + 1} / ${items.length} 張（${it.space} · ${it.category}）...`;
          confirmBtn.textContent = `匯入中 (${i + 1}/${items.length})...`;

          const pageNum = `P${currentProject.pages.length + 1}`;
          const newPage = {
            id: `PG_${baseTs}_${i}`,
            pageNum,
            space: it.space,
            docTypeLabel: it.category,
            title: `${it.space} · ${it.category}`,
            sitePhotoUrl: "",
            lines: [],
            markers: [],
            paths: [],
            arrows: [],
            stickers: [],
            overlays: [],
            reviewLogs: []
          };

          const savedUrl = await savePhotoOfflineFirst(currentProject.id, newPage, it.file);
          newPage.sitePhotoUrl = savedUrl;
          memoryPhotoCache.set(newPage.id, savedUrl);
          currentProject.pages.push(newPage);
        }

        progText.textContent = `💾 正在更新工程目錄...`;
        await saveCurrentProject();
        closeAll();
        if (typeof onCompleted === "function") onCompleted();
      };
    };

    document.body.appendChild(overlay);
    renderModal();
  };

  picker.click();
}

function createBlankWhiteDataUrl() {
  const c = document.createElement("canvas");
  c.width = 1600; c.height = 1200;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.92);
}

async function createAndOpenNewPage(spaceName, options = {}) {
  const { docType = "度尺圖", withWhitePaper = false, insertAfterIdx = -1 } = options;
  if (!Array.isArray(currentProject.pages)) currentProject.pages = [];
  const newPage = {
    id: "PG_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    pageNum: `P${currentProject.pages.length + 1}`,
    space: spaceName || "總圖",
    docTypeLabel: docType,
    title: `${spaceName || "總圖"} · ${docType}`,
    sitePhotoUrl: withWhitePaper ? createBlankWhiteDataUrl() : "",
    lines: [],
    markers: [],
    paths: [],
    arrows: [],
    stickers: [],
    overlays: [],
    reviewLogs: []
  };

  if (newPage.sitePhotoUrl) {
    memoryPhotoCache.set(newPage.id, newPage.sitePhotoUrl);
  }

  let targetIdx;
  if (insertAfterIdx >= 0 && insertAfterIdx < currentProject.pages.length) {
    targetIdx = insertAfterIdx + 1;
    currentProject.pages.splice(targetIdx, 0, newPage);
  } else {
    currentProject.pages.push(newPage);
    targetIdx = currentProject.pages.length - 1;
  }

  currentProject.pages.forEach((pg, idx) => { pg.pageNum = `P${idx + 1}`; });
  activePageIdx = targetIdx;
  await saveCurrentProject();
  renderWorkspace();
}

function shrinkDataUrlForCloud(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || dataUrl.length < 750000) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * sc);
      c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function backupAndSyncProjectToCloud(proj, onProgress = null) {
  if (!proj || !Array.isArray(proj.pages)) return { synced: 0, total: 0 };
  const targetPages = proj.pages;
  await idbSaveProject(proj);
  let syncedCloudCnt = 0;

  for (let i = 0; i < targetPages.length; i++) {
    const pg = targetPages[i];
    if (onProgress) onProgress(i + 1, targetPages.length, pg);
    const rawUrl = await ensureSinglePagePhoto(proj, pg);
    if (rawUrl) {
      const safeUrl = await shrinkDataUrlForCloud(rawUrl);
      pg.sitePhotoUrl = safeUrl;
      memoryPhotoCache.set(pg.id, safeUrl);
      const refId = pg.mediaRefId || `M_${proj.id}_${pg.id}`;
      pg.mediaRefId = refId;
      await idbSaveMedia(refId, safeUrl, { projectId: proj.id, pageId: pg.id });

      const mediaPayload = {
        projectId: proj.id,
        pageId: pg.id,
        imageData: safeUrl,
        updatedAt: Date.now()
      };

      if (navigator.onLine) {
        try {
          await setDoc(doc(db, MEDIA_COL, String(refId)), mediaPayload);
          syncedCloudCnt++;
        } catch (_) {
          await idbEnqueueSync({ type: "MEDIA", targetId: String(refId), payload: mediaPayload });
        }
      } else {
        await idbEnqueueSync({ type: "MEDIA", targetId: String(refId), payload: mediaPayload });
      }
    }
  }

  const slimPages = targetPages.map(pg => ({ ...pg, sitePhotoUrl: "" }));
  const projPayload = { ...proj, pages: slimPages, updatedAt: Date.now() };
  upsertLocalProject(proj);

  if (navigator.onLine) {
    await setDoc(doc(db, PROJ_COL, proj.id), projPayload).catch(() =>
      idbEnqueueSync({ type: "PROJECT", targetId: proj.id, payload: projPayload })
    );
  } else {
    await idbEnqueueSync({ type: "PROJECT", targetId: proj.id, payload: projPayload });
  }

  return { synced: syncedCloudCnt, total: targetPages.length };
}

window.history.pushState({ measuringGuard: true }, "");
window.addEventListener("popstate", () => {
  window.history.pushState({ measuringGuard: true }, "");
  if (compareSpaceName) { compareSpaceName = null; renderWorkspace(); }
  else if (currentProject && activePageIdx >= 0) {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(false);
    saveCurrentProject().finally(() => { activePageIdx = -1; renderWorkspace(); });
  } else if (currentProject) {
    if (confirm("確定要離開目前工程返回工程目錄嗎？")) {
      const leavingProj = currentProject;
      currentProject = null;
      renderProjectList();
      backupAndSyncProjectToCloud(leavingProj, (cur, tot) => {
        updateNetworkBanner(`🔄 背景備份並上雲 (${cur}/${tot})...`);
      }).then((res) => {
        updateNetworkBanner(`✅ 已自動備份並上雲 (${res.synced}/${res.total}張)`);
      });
    }
  }
});

const shareToken = new URLSearchParams(window.location.search).get("share");
if (shareToken) {
  applyBrandTitle();
  renderPublicShareReportView(root, shareToken);
} else {
  checkBrowserCompatibility();
  updateNetworkBanner();

  const bootOfflineIfCached = async () => {
    if (!navigator.onLine && localStorage.getItem(OFFLINE_AUTH_FLAG) === "1") {
      applyBrandTitle();
      masterDict = await loadMasterDict().catch(() => null);
      await loadCloudDictionaryFromDB();
      const idbList = await idbGetAllProjects();
      if (idbList.length) saveLocalProjects(idbList);
      renderProjectList();
      return true;
    }
    return false;
  };

  bootOfflineIfCached().then((startedOffline) => {
    if (startedOffline) return;
    watchAuth(async () => {
      localStorage.setItem(OFFLINE_AUTH_FLAG, "1");
      applyBrandTitle();
      masterDict = await loadMasterDict();
      await loadCloudDictionaryFromDB();
      await flushOfflineSyncQueue();
      renderProjectList();
    }, () => {
      applyBrandTitle();
      renderLoginView(root);
    });
  });
}

async function fetchAllCloudProjectsSplit(forceRefresh = false) {
  if (!navigator.onLine) {
    const idbAll = await idbGetAllProjects();
    return {
      active: dedupProjects(idbAll.filter(x => x.archived !== true)),
      archived: dedupProjects(idbAll.filter(x => x.archived === true))
    };
  }
  if (!forceRefresh && Array.isArray(cachedCloudActiveList) && Array.isArray(cachedCloudArchivedList)) {
    return { active: cachedCloudActiveList, archived: cachedCloudArchivedList };
  }
  const snap = await getDocs(collection(db, PROJ_COL));
  const rawActive = [];
  const rawArchived = [];
  snap.forEach(d => {
    const item = { id: d.id, ...d.data() };
    idbSaveProject(item).catch(() => {});
    if (item.archived === true) rawArchived.push(item);
    else rawActive.push(item);
  });
  cachedCloudActiveList = dedupProjects(rawActive);
  cachedCloudArchivedList = dedupProjects(rawArchived);
  return { active: cachedCloudActiveList, archived: cachedCloudArchivedList };
}

async function fetchActiveCloudProjects(forceRefresh = false) {
  const { active } = await fetchAllCloudProjectsSplit(forceRefresh);
  return active;
}

async function fetchArchivedCloudProjects(forceRefresh = false) {
  const { archived } = await fetchAllCloudProjectsSplit(forceRefresh);
  return archived;
}

async function renderProjectList(options = {}) {
  applyBrandTitle();
  const { openSummon = false, forceFetchCloud = false } = options;
  let localList = getLocalProjects().filter(p => p.archived !== true);
  const hiddenSet = getHiddenIds();

  if (localList.length === 0) {
    const idbCached = await idbGetAllProjects();
    if (idbCached.length) {
      localList = idbCached.filter(p => p.archived !== true && !hiddenSet.has(p.id));
      saveLocalProjects(localList);
    } else if (navigator.onLine && !localStorage.getItem(LOCAL_ACTIVE_KEY)) {
      root.innerHTML = `<div class="card">首次初始化進行中工程清單...</div>`;
      const activeFromCloud = await fetchActiveCloudProjects(false);
      localList = activeFromCloud.filter(p => !hiddenSet.has(p.id));
      saveLocalProjects(localList);
    }
  }

  const visibleProjects = localList
    .filter(p => !hiddenSet.has(p.id) && p.archived !== true)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  root.innerHTML = `
    <div class="card" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
      <input type="text" id="new-proj-name" placeholder="輸入新工程名稱"
             style="flex:1; min-width:170px; padding:6px 8px; border:1px solid #111827; border-radius:4px; font-size:14px;" />
      <button id="btn-create-proj" class="btn-solid">+ 建立工程</button>
      <button id="btn-summon-proj" class="btn-outline" style="color:#1D4ED8; border-color:#93C5FD; font-weight:800; background:#EFF6FF;">📣 召喚工程</button>
      <button id="btn-home-cloud-dict" class="btn-outline" style="color:#0F172A;">⚙️ 雲端詞庫</button>
      <button id="btn-db-cleaner" class="btn-outline" style="color:#475569;">🧹 資料庫清理</button>
    </div>

    <div id="summon-cloud-box" class="card ${openSummon ? "" : "hidden"}" style="background:#EFF6FF; border:1.5px solid #3B82F6;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
        <strong style="font-size:13px; color:#1E3A8A;">📣 召喚工程（雲端及本機快取清單）</strong>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <label style="font-size:11px; color:#334155; display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" id="chk-show-archived-summon" ${showArchivedInSummon ? "checked" : ""} />
            查看已完工封存
          </label>
          <button id="btn-refresh-summon" class="btn-outline btn-sm" style="color:#1D4ED8; border-color:#93C5FD;">🔄 刷新</button>
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
      <div id="cleaner-body" style="font-size:12px; color:#334155;">正在掃描資料庫...</div>
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
                          style="background:none; border:1px solid #E2E8F0; border-radius:5px; padding:1px 5px; font-size:11px; color:#64748B; cursor:pointer;">✏️</button>
                  ${fixCnt > 0 ? `<span style="font-size:11px; background:#FEE2E2; color:#991B1B; font-weight:700; padding:1px 6px; border-radius:4px;">❌ ${fixCnt}需改</span>` : ""}
                  ${checkCnt > 0 ? `<span style="font-size:11px; background:#FEF3C7; color:#92400E; font-weight:700; padding:1px 6px; border-radius:4px;">⚠️ ${checkCnt}待核/補</span>` : ""}
                </div>
                <div style="font-size:12px; color:#6B7280; margin-top:2px; cursor:pointer;" data-id="${p.id}">
                  共 ${(p.pages || []).length} 頁圖紙 · 更新於 ${formatUpdatedTime(p.updatedAt)}
                </div>
              </div>

              <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline btn-sm"
                   style="text-decoration:none; color:#0284C7; border-color:#BAE6FD; font-weight:700;">🗺️ Map</a>
                <button class="btn-outline btn-sm" style="color:#059669; border-color:#A7F3D0; font-weight:700;" data-archive-id="${p.id}">✅ 完工封存</button>
                <button class="btn-outline btn-sm" style="color:#64748B; border-color:#CBD5E1;" data-hide-id="${p.id}">📦 移除</button>
                <button class="btn-solid btn-sm" data-id="${p.id}">進入空間圖集 →</button>
              </div>
            </div>
            ${isContactOpen ? renderContactDrawerHtml(p) : ""}
          </div>
        `;
      }).join("") || `
        <div class="card" style="color:#475569; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span>目前首頁沒有進行中的工程。</span>
          <button id="btn-empty-summon" class="btn-solid btn-sm">📣 立即召喚工程</button>
        </div>
      `}
    </div>
  `;

  document.getElementById("btn-home-cloud-dict").onclick = () => openCloudDictModal("SPACE");
  const emptySummonBtn = document.getElementById("btn-empty-summon");
  if (emptySummonBtn) emptySummonBtn.onclick = () => { document.getElementById("summon-cloud-box").classList.remove("hidden"); populateSummonList(false); };

  document.getElementById("btn-create-proj").onclick = async () => {
    const name = cleanProjectTitle(document.getElementById("new-proj-name").value.trim());
    if (!name) return;
    const id = "P_" + Date.now();
    const newProj = { id, name, pages: [], contacts: [], archived: false, updatedAt: Date.now() };
    upsertLocalProject(newProj);
    if (navigator.onLine) {
      await setDoc(doc(db, PROJ_COL, id), newProj).catch(() => idbEnqueueSync({ type: "PROJECT", targetId: id, payload: newProj }));
    } else {
      await idbEnqueueSync({ type: "PROJECT", targetId: id, payload: newProj });
    }
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
    btn.onclick = (e) => { e.stopPropagation(); const pid = btn.dataset.contactPid; openContactProjId = openContactProjId === pid ? null : pid; renderProjectList(); };
  });
  bindContactEvents(visibleProjects, () => renderProjectList());

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
      target.name = cleanTitle; target.archived = true; target.archivedAt = Date.now();
      const slimPages = (target.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
      const payload = { ...target, pages: slimPages };
      await idbSaveProject(payload);
      if (navigator.onLine) {
        await setDoc(doc(db, PROJ_COL, target.id), payload).catch(() => idbEnqueueSync({ type: "PROJECT", targetId: target.id, payload }));
      } else {
        await idbEnqueueSync({ type: "PROJECT", targetId: target.id, payload });
      }
      removeLocalProjectById(target.id);
      if (Array.isArray(cachedCloudActiveList)) cachedCloudActiveList = cachedCloudActiveList.filter(x => x.id !== target.id);
      if (Array.isArray(cachedCloudArchivedList)) cachedCloudArchivedList.unshift(target);
      renderProjectList();
    };
  });

  root.querySelectorAll("[data-hide-id]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); const pid = btn.dataset.hideId; const s = getHiddenIds(); s.add(pid); saveHiddenIds(s); removeLocalProjectById(pid); renderProjectList(); };
  });

  root.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = async () => { const found = visibleProjects.find(p => p.id === el.dataset.id); if (found) await openProjectLightweight(found); };
  });
}

function renderContactDrawerHtml(proj) {
  const contacts = Array.isArray(proj.contacts) ? proj.contacts : [];
  const rolePresets = ["in charge", "設計師", "業主", "判頭", "現場負責", "管理處"];
  return `
    <div style="background:#FFFBEB; border:1px solid #FCD34D; border-radius:6px; padding:7px 9px; display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="font-size:12px; color:#92400E;">👤 隨手臨時聯絡記錄</strong>
        <button class="btn-contact-close btn-outline btn-sm" style="padding:1px 6px; font-size:11px;">收起</button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:5px; align-items:center;">
        <input type="text" id="ct-name-${proj.id}" placeholder="人名 / 事項"
               style="flex:1.2; min-width:110px; padding:5px 7px; border:1px solid #D97706; border-radius:4px; font-size:12px; background:#FFF;" />
        <input type="text" id="ct-role-${proj.id}" placeholder="崗位 / 備註（如：in charge）"
               style="flex:1.2; min-width:120px; padding:5px 7px; border:1px solid #D97706; border-radius:4px; font-size:12px; background:#FFF;" />
        <input type="tel" id="ct-phone-${proj.id}" placeholder="電話（選填）"
               style="flex:1; min-width:100px; padding:5px 7px; border:1px solid #D97706; border-radius:4px; font-size:12px; background:#FFF;" />
        <button class="btn-solid btn-sm btn-ct-add" data-pid="${proj.id}" style="background:#D97706; border-color:#D97706;">+ 記低</button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:4px;">
        ${rolePresets.map(r => `
          <button type="button" class="btn-ct-role-preset" data-pid="${proj.id}" data-rval="${r}"
                  style="background:#FEF3C7; color:#92400E; border:1px solid #F59E0B; border-radius:999px; padding:1px 7px; font-size:10px; font-weight:700; cursor:pointer;">
            + ${r}
          </button>
        `).join("")}
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${contacts.map((c, idx) => {
          const waUrl = formatWhatsAppUrl(c.phone);
          const roleText = c.role || c.note || "";
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; background:#FFF; border:1px solid #FDE68A; border-radius:5px; padding:4px 8px; flex-wrap:wrap;">
              <div style="font-size:12px; color:#1E293B; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                <strong>${c.name || "臨時記錄"}</strong>
                ${roleText ? `<span style="background:#FEF3C7; color:#92400E; border:1px solid #FCD34D; border-radius:4px; padding:0 5px; font-size:11px; font-weight:700;">${roleText}</span>` : ""}
                ${c.phone ? `<span style="color:#0284C7; font-weight:600;">${c.phone}</span>` : ""}
              </div>
              <div style="display:flex; gap:5px; align-items:center;">
                ${c.phone ? `<a href="tel:${c.phone}" class="btn-outline btn-sm" style="text-decoration:none; padding:1px 6px; font-size:11px; color:#059669; border-color:#6EE7B7;">📞 撥打</a>` : ""}
                ${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline btn-sm" style="text-decoration:none; padding:1px 6px; font-size:11px; color:#16A34A; border-color:#86EFAC;">💬 WhatsApp</a>` : ""}
                <button class="btn-ct-edit" data-pid="${proj.id}" data-cidx="${idx}" title="編輯崗位或電話" style="background:none; border:none; color:#475569; font-size:11px; cursor:pointer; padding:0 3px;">✏️</button>
                <button class="btn-ct-del" data-pid="${proj.id}" data-cidx="${idx}" style="background:none; border:none; color:#94A3B8; font-size:12px; cursor:pointer; padding:0 4px;">✕</button>
              </div>
            </div>
          `;
        }).join("") || `<div style="font-size:11px; color:#92400E;">尚無臨時記錄。</div>`}
      </div>
    </div>
  `;
}

async function persistProjectObject(proj) {
  const slimPages = (proj.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }));
  const payload = { ...proj, pages: slimPages };
  upsertLocalProject(proj);
  if (!navigator.onLine) {
    await idbEnqueueSync({ type: "PROJECT", targetId: proj.id, payload });
    return;
  }
  try {
    await setDoc(doc(db, PROJ_COL, proj.id), payload);
  } catch (_) {
    await idbEnqueueSync({ type: "PROJECT", targetId: proj.id, payload });
  }
}

function bindContactEvents(projectListRef, onRefresh) {
  root.querySelectorAll(".btn-contact-close").forEach(btn => { btn.onclick = () => { openContactProjId = null; onRefresh(); }; });
  root.querySelectorAll(".btn-ct-role-preset").forEach(btn => {
    btn.onclick = () => {
      const inp = document.getElementById(`ct-role-${btn.dataset.pid}`);
      if (inp) { inp.value = btn.dataset.rval; inp.focus(); }
    };
  });
  root.querySelectorAll(".btn-ct-add").forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const target = projectListRef.find(p => p.id === pid);
      if (!target) return;
      const nameVal = (document.getElementById(`ct-name-${pid}`)?.value || "").trim();
      const roleVal = (document.getElementById(`ct-role-${pid}`)?.value || "").trim();
      const phoneVal = (document.getElementById(`ct-phone-${pid}`)?.value || "").trim();
      if (!nameVal && !roleVal && !phoneVal) return;
      if (!Array.isArray(target.contacts)) target.contacts = [];
      target.contacts.push({ name: nameVal || "聯絡記錄", role: roleVal, phone: phoneVal });
      target.updatedAt = Date.now();
      await persistProjectObject(target);
      onRefresh();
    };
  });
  root.querySelectorAll(".btn-ct-edit").forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const target = projectListRef.find(p => p.id === pid);
      const item = target?.contacts?.[Number(btn.dataset.cidx)];
      if (!item) return;
      const nextName = prompt("修改人名 / 事項：", item.name || "");
      if (nextName === null) return;
      const nextRole = prompt("修改崗位 / 備註（如：in charge）：", item.role || item.note || "");
      if (nextRole === null) return;
      const nextPhone = prompt("修改電話：", item.phone || "");
      if (nextPhone === null) return;
      item.name = nextName.trim() || item.name;
      item.role = nextRole.trim();
      item.phone = nextPhone.trim();
      target.updatedAt = Date.now();
      await persistProjectObject(target);
      onRefresh();
    };
  });
  root.querySelectorAll(".btn-ct-del").forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const target = projectListRef.find(p => p.id === pid);
      if (!target || !Array.isArray(target.contacts)) return;
      target.contacts.splice(Number(btn.dataset.cidx), 1);
      target.updatedAt = Date.now();
      await persistProjectObject(target);
      onRefresh();
    };
  });
}

async function renameProjectEverywhere(proj, newCleanName) {
  proj.name = newCleanName;
  proj.updatedAt = Date.now();
  await persistProjectObject(proj);
  if (Array.isArray(cachedCloudActiveList)) {
    const found = cachedCloudActiveList.find(x => x.id === proj.id);
    if (found) found.name = newCleanName;
  }
}

async function populateSummonList(forceRefresh = false) {
  const listBody = document.getElementById("summon-list-body");
  if (!listBody) return;
  listBody.innerHTML = `<div style="font-size:12px; color:#475569; padding:8px;">正在查詢工程清單...</div>`;
  try {
    const activeList = await fetchActiveCloudProjects(forceRefresh);
    let combinedList = [...activeList];
    if (showArchivedInSummon) {
      const archList = await fetchArchivedCloudProjects(forceRefresh);
      combinedList = [...activeList, ...archList];
    }
    const kw = summonSearchText.trim().toLowerCase();
    const filtered = kw ? combinedList.filter(p => cleanProjectTitle(p.name).toLowerCase().includes(kw)) : combinedList;
    const localIds = new Set(getLocalProjects().map(x => x.id));
    const hiddenSet = getHiddenIds();

    if (!filtered.length) {
      listBody.innerHTML = `<div style="font-size:12px; color:#64748B; padding:8px;">找不到符合條件的工程。</div>`;
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
            <div style="font-size:11px; color:#64748B; margin-top:2px;">🕒 ${formatUpdatedTime(p.updatedAt)} · 共 ${(p.pages || []).length} 頁</div>
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
        const s = getHiddenIds(); s.delete(found.id); saveHiddenIds(s);
        upsertLocalProject(found);
        await openProjectLightweight(found);
      };
    });

    listBody.querySelectorAll(".summon-unarchive-btn").forEach(btn => {
      btn.onclick = async () => {
        const found = combinedList.find(p => p.id === btn.dataset.sid);
        if (!found) return;
        found.archived = false; found.updatedAt = Date.now();
        await persistProjectObject(found);
        const s = getHiddenIds(); s.delete(found.id); saveHiddenIds(s);
        cachedCloudActiveList = null; cachedCloudArchivedList = null;
        renderProjectList({ openSummon: true, forceFetchCloud: true });
      };
    });
  } catch (err) {
    listBody.innerHTML = `<div style="font-size:12px; color:#DC2626; padding:8px;">查詢失敗：${err.message || err}</div>`;
  }
}

async function openDatabaseCleaner() {
  const box = document.getElementById("db-cleaner-box");
  const body = document.getElementById("cleaner-body");
  box.classList.remove("hidden");
  if (!navigator.onLine) {
    body.innerHTML = `<span style="color:#D97706;">離線模式無法連線雲端資料庫清理，請恢復連線後使用。</span>`;
    return;
  }
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
      cachedCloudActiveList = null; cachedCloudArchivedList = null;
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

  const lookupKey = page.mediaRefId ? String(page.mediaRefId) : `PAGE_${page.id}`;
  const idbData = await idbGetMedia(lookupKey);
  if (idbData) {
    page.sitePhotoUrl = idbData;
    memoryPhotoCache.set(page.id, idbData);
    return idbData;
  }

  if (!navigator.onLine) return "";

  if (page.mediaRefId) {
    try {
      const mDoc = await getDoc(doc(db, MEDIA_COL, String(page.mediaRefId)));
      if (mDoc.exists() && mDoc.data().imageData) {
        page.sitePhotoUrl = mDoc.data().imageData;
        memoryPhotoCache.set(page.id, page.sitePhotoUrl);
        await idbSaveMedia(String(page.mediaRefId), page.sitePhotoUrl, { projectId: proj?.id, pageId: page.id });
        return page.sitePhotoUrl;
      }
    } catch (_) {}
  }
  if (proj && proj.legacySourceId && page.legacyMediaId) {
    const url = await resolveLegacyMediaPhoto(proj.legacySourceId, page.legacyMediaId);
    if (url) {
      page.sitePhotoUrl = url;
      memoryPhotoCache.set(page.id, url);
      await idbSaveMedia(lookupKey, url, { projectId: proj?.id, pageId: page.id });
      return url;
    }
  }
  return "";
}

async function openProjectLightweight(proj) {
  if (!navigator.onLine) {
    const idbAll = await idbGetAllProjects();
    const localFound = idbAll.find(x => x.id === proj.id) || proj;
    (localFound.pages || []).forEach(pg => { if (memoryPhotoCache.has(pg.id)) pg.sitePhotoUrl = memoryPhotoCache.get(pg.id); });
    openProject(localFound);
    return;
  }
  root.innerHTML = `<div class="card">載入空間圖集目錄中...</div>`;
  try {
    const freshSnap = await getDoc(doc(db, PROJ_COL, proj.id));
    if (freshSnap.exists()) {
      const freshData = { id: freshSnap.id, ...freshSnap.data() };
      (freshData.pages || []).forEach(pg => { if (memoryPhotoCache.has(pg.id)) pg.sitePhotoUrl = memoryPhotoCache.get(pg.id); });
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
    if (combined && !combined.startsWith("data:image") && !combined.startsWith("http")) combined = "data:image/jpeg;base64," + combined;
    return combined;
  } catch (_) { return ""; }
}

function openProject(proj) {
  currentProject = proj;
  activePageIdx = -1;
  compareSpaceName = null;
  filterSpace = "ALL";
  filterCategory = "ALL";
  renderWorkspace();
}

async function saveCurrentProject() {
  if (!currentProject) return;
  const syncEl = document.getElementById("top-auto-save-status");
  if (syncEl) {
    syncEl.textContent = "⏳ 儲存中...";
    syncEl.style.color = "#D97706";
  }
  currentProject.updatedAt = Date.now();
  const slimPages = (currentProject.pages || []).map(p => {
    if (p.sitePhotoUrl) {
      memoryPhotoCache.set(p.id, p.sitePhotoUrl);
      const refKey = p.mediaRefId ? String(p.mediaRefId) : `PAGE_${p.id}`;
      idbSaveMedia(refKey, p.sitePhotoUrl, { projectId: currentProject.id, pageId: p.id }).catch(() => {});
    }
    return { ...p, sitePhotoUrl: "" };
  });

  const payload = { ...currentProject, pages: slimPages };
  upsertLocalProject(currentProject);

  if (!navigator.onLine) {
    await idbEnqueueSync({ type: "PROJECT", targetId: currentProject.id, payload });
    if (syncEl) {
      syncEl.textContent = "💾 已存本機（待連線同步）";
      syncEl.style.color = "#B45309";
    }
    return;
  }

  try {
    await setDoc(doc(db, PROJ_COL, currentProject.id), payload);
    if (syncEl) {
      syncEl.textContent = "☁️ 已自動儲存";
      syncEl.style.color = "#059669";
    }
  } catch (_) {
    await idbEnqueueSync({ type: "PROJECT", targetId: currentProject.id, payload });
    if (syncEl) {
      syncEl.textContent = "💾 已存本機（待連線同步）";
      syncEl.style.color = "#B45309";
    }
  }
}

function compressFileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1600;
        const sc = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * sc);
        c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.84));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function savePhotoOfflineFirst(projectId, page, file) {
  const refId = page.mediaRefId || `M_${projectId}_${page.id}`;
  page.mediaRefId = refId;

  if (!navigator.onLine) {
    const dataUrl = await compressFileToDataUrl(file);
    await idbSaveMedia(refId, dataUrl, { projectId, pageId: page.id });
    await idbEnqueueSync({
      type: "MEDIA",
      targetId: String(refId),
      payload: { projectId, pageId: page.id, imageData: dataUrl, updatedAt: Date.now() }
    });
    return dataUrl;
  }

  try {
    const res = await uploadMediaToCloud(projectId, page.id, file);
    if (res?.mediaRefId) page.mediaRefId = res.mediaRefId;
    await idbSaveMedia(page.mediaRefId, res.imageData, { projectId, pageId: page.id });
    return res.imageData;
  } catch (_) {
    const dataUrl = await compressFileToDataUrl(file);
    await idbSaveMedia(refId, dataUrl, { projectId, pageId: page.id });
    await idbEnqueueSync({
      type: "MEDIA",
      targetId: String(refId),
      payload: { projectId, pageId: page.id, imageData: dataUrl, updatedAt: Date.now() }
    });
    return dataUrl;
  }
}

function getSpaceRank(sp) {
  if (!sp || sp === "未標空間") return 999;
  if (sp === "總圖") return 0;
  const order = currentProject?.spaceOrder || [];
  const idx = order.indexOf(sp);
  return idx === -1 ? 500 : idx + 1;
}

function renderWorkspace() {
  if (compareSpaceName) { renderSideBySideCompare(compareSpaceName); return; }
  if (activePageIdx >= 0 && currentProject.pages[activePageIdx]) { renderSinglePageEditor(currentProject.pages[activePageIdx]); return; }
  activeCanvasInstance = null;
  renderOverview();
}

function renderOverview() {
  const myGen = ++overviewRenderGeneration;
  const pages = currentProject.pages || [];
  const displayTitle = cleanProjectTitle(currentProject.name);
  const contacts = Array.isArray(currentProject.contacts) ? currentProject.contacts : [];
  const allSpaces = [...new Set(pages.map(p => p.space || "未標空間"))].sort((a, b) => getSpaceRank(a) - getSpaceRank(b));

  const catCounts = { ALL: pages.length, "度尺圖": 0, "平面圖": 0, "繪圖": 0, "效果圖": 0 };
  let fixTotal = 0;
  pages.forEach(p => {
    const cat = normalizePageCategory(p);
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    (p.reviewLogs || []).forEach(r => { if (normalizeReviewStatus(r.status) === "NEED_FIX") fixTotal++; });
  });

  const filteredPages = pages.filter(p => {
    const spOk = filterSpace === "ALL" || (p.space || "未標空間") === filterSpace;
    const catOk = filterCategory === "ALL" || normalizePageCategory(p) === filterCategory;
    return spOk && catOk;
  });

  const groupsMap = new Map();
  filteredPages.forEach(p => {
    const sp = p.space || "未標空間";
    if (!groupsMap.has(sp)) groupsMap.set(sp, []);
    groupsMap.get(sp).push(p);
  });

  const sortedGroups = Array.from(groupsMap.entries())
    .sort((a, b) => getSpaceRank(a[0]) - getSpaceRank(b[0]))
    .map(([sp, items]) => [sp, [...items].sort((a, b) => (CAT_RANK[normalizePageCategory(a)] || 9) - (CAT_RANK[normalizePageCategory(b)] || 9))]);

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; padding:6px 10px; background:#FFF; border:1px solid #E2E8F0; border-radius:8px; margin-bottom:6px;">
      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
        <button id="btn-back-list" class="btn-outline btn-sm">‹ 目錄</button>
        <strong style="font-size:15px; color:#0F172A;">${displayTitle}</strong>
        <button id="btn-overview-contact" title="隨手臨時聯絡記錄"
                style="background:${contacts.length > 0 ? "#FEF3C7" : "#F1F5F9"}; color:${contacts.length > 0 ? "#92400E" : "#475569"}; border:1px solid ${contacts.length > 0 ? "#F59E0B" : "#CBD5E1"}; border-radius:999px; padding:1px 7px; font-size:12px; font-weight:700; cursor:pointer;">
          👤${contacts.length > 0 ? ` ${contacts.length}` : ""}
        </button>
        <button id="btn-overview-rename" title="修改工程名稱"
                style="background:none; border:1px solid #E2E8F0; border-radius:5px; padding:1px 5px; font-size:11px; color:#64748B; cursor:pointer;">✏️</button>
      </div>
      <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
        <button id="btn-batch-upload-base" class="btn-solid btn-sm" style="background:#2563EB; border-color:#2563EB;">📤 批量上底圖</button>
        <button id="btn-quick-new-blank" class="btn-outline btn-sm" style="color:#0F172A; font-weight:800;">📄 插白紙</button>
        <button id="btn-offline-cache-all" class="btn-outline btn-sm" style="color:#059669; border-color:#86EFAC; background:#F0FDF4; font-weight:800;">☁️ 備份並上雲</button>
        <button id="btn-cloud-dict-open" class="btn-outline btn-sm" style="color:#1D4ED8; border-color:#93C5FD;">⚙️ 雲端詞庫</button>
        <button id="btn-review-board" class="btn-outline btn-sm" style="border-color:#FCA5A5; color:#DC2626; font-weight:700;">
          📋 批改總表${fixTotal > 0 ? ` (${fixTotal})` : ""}
        </button>
        <button id="btn-add-space" class="btn-outline btn-sm">+ 空間</button>
        <button id="btn-open-report" class="btn-solid btn-sm">客戶報告</button>
      </div>
    </div>

    <div id="overview-contact-box" class="hidden" style="margin-bottom:6px;">${renderContactDrawerHtml(currentProject)}</div>

    <div id="project-review-board" class="card hidden" style="background:#FFFBFB; border:1.5px solid #FCA5A5; margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#991B1B;">📋 本工程審圖批改總表（點擊狀態徽章可循環切換）</strong>
        <button id="btn-close-review-board" class="btn-outline btn-sm">關閉</button>
      </div>
      <div id="project-review-list" style="display:flex; flex-direction:column; gap:5px; font-size:12px;"></div>
    </div>

    <div style="display:flex; align-items:center; justify-content:flex-start; gap:8px; padding:4px 8px; background:#FFF; border:1px solid #E2E8F0; border-radius:999px; margin-bottom:8px; overflow-x:auto; white-space:nowrap;">
      <div style="display:flex; align-items:center; gap:4px;">
        <button id="btn-space-sort-toggle" title="調整空間先後次序"
                style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:999px; padding:2px 7px; font-size:11px; font-weight:800; color:#334155; cursor:pointer;">
          ⇅ 排序
        </button>
        <button class="slim-chip ${filterSpace === "ALL" ? "active" : ""}" data-fsp="ALL">全部空間</button>
        ${allSpaces.map(sp => `<button class="slim-chip ${filterSpace === sp ? "active" : ""}" data-fsp="${sp}">${sp}</button>`).join("")}
        <button id="btn-preset-space-gear" title="加減預設空間清單"
                style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:999px; width:24px; height:24px; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
          ⚙️
        </button>
      </div>

      <div style="display:flex; align-items:center; gap:4px; padding-left:8px; border-left:1.5px solid #CBD5E1;">
        <button class="slim-chip ${filterCategory === "ALL" ? "active" : ""}" data-fcat="ALL">全部(${pages.length})</button>
        ${CORE_CATEGORIES.map(cat => `<button class="slim-chip ${filterCategory === cat ? "active" : ""}" data-fcat="${cat}">${cat}(${catCounts[cat] || 0})</button>`).join("")}
      </div>
    </div>

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

    <div id="dict-picker-box" class="card ${pages.length === 0 ? "" : "hidden"}" style="margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div class="section-title" style="margin:0;">第一步：點選空間（或直接按右上方「📤 批量上底圖」/「📄 插白紙」）</div>
        <button id="btn-picker-manage-sp" class="btn-outline btn-sm" style="font-size:11px;">⚙️ 加減預設空間</button>
      </div>
      <div class="chip-grid" id="picker-spaces" style="margin-bottom:8px;"></div>
      <div class="section-title">第二步：選擇訂造櫃體（選填）</div>
      <div class="chip-grid" id="picker-cabs" style="margin-bottom:10px;"></div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <input type="text" id="custom-page-title" placeholder="或直接輸入空間名稱" style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #111827; border-radius:4px; font-size:13px;" />
        <select id="new-page-doctype" style="padding:5px 8px; border:1px solid #111827; border-radius:4px; font-size:13px; font-weight:700;">
          <option value="度尺圖">度尺圖</option>
          <option value="平面圖">平面圖</option>
          <option value="繪圖">繪圖</option>
          <option value="效果圖">效果圖</option>
        </select>
        <button id="btn-confirm-page" class="btn-solid btn-sm">建立</button>
      </div>
    </div>

    <input type="file" id="quick-replace-measure-input" accept="image/*" class="hidden" />

    <div id="main-gallery-host"></div>

    <style>
      .slim-chip { background:transparent; border:1px solid transparent; border-radius:999px; padding:2px 8px; font-size:12px; font-weight:600; color:#475569; cursor:pointer; }
      .slim-chip:hover { background:#F1F5F9; }
      .slim-chip.active { background:#0F172A; color:#FFFFFF; }
    </style>
  `;

  document.getElementById("btn-back-list").onclick = () => {
    const leavingProj = currentProject;
    currentProject = null;
    renderProjectList();
    if (leavingProj && (leavingProj.pages || []).length > 0) {
      backupAndSyncProjectToCloud(leavingProj, (cur, tot) => {
        updateNetworkBanner(`🔄 返回目錄自動備份並上雲 (${cur}/${tot})...`);
      }).then((res) => {
        updateNetworkBanner(`✅ 已自動備份並上雲 (${res.synced}/${res.total}張)`);
      });
    }
  };

  document.getElementById("btn-add-space").onclick = () => document.getElementById("dict-picker-box").classList.toggle("hidden");
  document.getElementById("btn-cloud-dict-open").onclick = () => openCloudDictModal("STAMP");
  document.getElementById("btn-preset-space-gear").onclick = () => openCloudDictModal("SPACE", () => renderOverview());
  document.getElementById("btn-picker-manage-sp").onclick = () => openCloudDictModal("SPACE", () => renderOverview());

  document.getElementById("btn-batch-upload-base").onclick = () => {
    openBatchUploadModal(allSpaces, () => renderOverview());
  };

  document.getElementById("btn-quick-new-blank").onclick = () => {
    const targetSp = filterSpace !== "ALL" ? filterSpace : (allSpaces[0] || "總圖");
    createAndOpenNewPage(targetSp, { docType: "度尺圖", withWhitePaper: true });
  };

  document.getElementById("btn-offline-cache-all").onclick = async () => {
    const btn = document.getElementById("btn-offline-cache-all");
    btn.disabled = true;
    const res = await backupAndSyncProjectToCloud(currentProject, (cur, tot) => {
      btn.textContent = `⏳ 備份並上雲 (${cur}/${tot})...`;
    });
    btn.disabled = false;
    btn.textContent = `✅ 已備份並上雲 (${res.synced}/${res.total}張)`;
  };

  document.getElementById("btn-overview-contact").onclick = () => document.getElementById("overview-contact-box").classList.toggle("hidden");
  bindContactEvents([currentProject], () => {
    renderOverview();
    document.getElementById("overview-contact-box")?.classList.remove("hidden");
  });

  document.getElementById("btn-overview-rename").onclick = async () => {
    const nextName = prompt("修改工程名稱：", cleanProjectTitle(currentProject.name));
    if (nextName === null) return;
    const trimmed = cleanProjectTitle(nextName);
    if (!trimmed || trimmed === currentProject.name) return;
    await renameProjectEverywhere(currentProject, trimmed);
    renderOverview();
  };

  document.getElementById("btn-open-report").onclick = async () => {
    root.innerHTML = `<div class="card">正在為報告預覽載入底圖...</div>`;
    await Promise.all((currentProject.pages || []).map(pg => ensureSinglePagePhoto(currentProject, pg)));
    renderReportBuilder(root, currentProject, renderWorkspace);
  };

  document.getElementById("btn-review-board").onclick = () => {
    const board = document.getElementById("project-review-board");
    board.classList.toggle("hidden");
    if (!board.classList.contains("hidden")) renderProjectReviewList();
  };
  document.getElementById("btn-close-review-board").onclick = () => document.getElementById("project-review-board").classList.add("hidden");

  document.getElementById("btn-space-sort-toggle").onclick = () => document.getElementById("space-sort-drawer").classList.toggle("hidden");
  document.getElementById("btn-close-space-sort").onclick = () => document.getElementById("space-sort-drawer").classList.add("hidden");

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

  root.querySelectorAll("[data-fsp]").forEach(btn => { btn.onclick = () => { filterSpace = btn.dataset.fsp; renderOverview(); }; });
  root.querySelectorAll("[data-fcat]").forEach(btn => { btn.onclick = () => { filterCategory = btn.dataset.fcat; renderOverview(); }; });

  setupDictPicker();
  renderFlatExpandedGallery(document.getElementById("main-gallery-host"), sortedGroups, pages, allSpaces, myGen);
}

function renderFlatExpandedGallery(host, sortedGroups, allPages, allSpaces, renderGen) {
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
        lines: [], markers: [], paths: [], arrows: [], stickers: [], overlays: [], reviewLogs: []
      };
      currentProject.pages.push(targetPage);
    }
    const savedUrl = await savePhotoOfflineFirst(currentProject.id, targetPage, file);
    targetPage.sitePhotoUrl = savedUrl;
    targetPage.docTypeLabel = "度尺圖";
    memoryPhotoCache.set(targetPage.id, savedUrl);
    await saveCurrentProject();
    pendingReplaceSpace = null;
    replaceInput.value = "";
    renderOverview();
  };

  host.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      ${sortedGroups.map(([spaceName, items]) => `
        <div style="background:#FFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:15px; color:#0F172A;">${spaceName}</strong>
              <span style="font-size:11px; background:#F1F5F9; color:#475569; padding:1px 7px; border-radius:999px; font-weight:700;">${items.length}張</span>
            </div>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
              <button class="btn-sp-add-page" data-aspace="${spaceName}"
                      style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">
                ➕ 加頁 / 拍照
              </button>
              <button class="btn-sp-add-blank" data-bspace="${spaceName}"
                      style="background:#F8FAFC; color:#0F172A; border:1px solid #CBD5E1; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">
                📄 插白紙
              </button>
              <button class="btn-quick-replace-measure" data-rspace="${spaceName}"
                      style="background:#F0FDF4; color:#166534; border:1px solid #BBF7D0; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">
                📷 替換度尺圖
              </button>
              <button class="btn-quick-compare" data-cspace="${spaceName}"
                      style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">
                ⚖️ 左右對照
              </button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(225px, 1fr)); gap:9px;">
            ${items.map(p => {
              const realIdx = allPages.indexOf(p);
              const cat = normalizePageCategory(p);
              const cachedUrl = p.sitePhotoUrl || memoryPhotoCache.get(p.id) || "";
              const annCnt = (p.lines || []).length + (p.markers || []).length + (p.paths || []).length + (p.arrows || []).length;
              return `
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; overflow:hidden; display:flex; flex-direction:column;">
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:#FFF; border-bottom:1px solid #F1F5F9; font-size:12px; gap:4px;">
                    <div style="display:flex; align-items:center; gap:4px;">
                      <strong style="color:#1E293B; cursor:pointer;" data-open-idx="${realIdx}">${p.pageNum || `P${realIdx + 1}`}</strong>
                      <span style="color:#94A3B8;">·</span>
                      <button type="button" class="btn-card-cat-tap" data-pidx="${realIdx}" title="點擊點選改分類或空間"
                              style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:4px; padding:1px 6px; font-size:11px; font-weight:800; cursor:pointer;">
                        ${cat}
                      </button>
                    </div>
                    <div style="display:flex; align-items:center; gap:4px;">
                      ${annCnt > 0 ? `<span style="font-size:10px; background:#EFF6FF; color:#1D4ED8; padding:1px 5px; border-radius:4px; font-weight:700;">📐${annCnt}</span>` : ""}
                      <button type="button" class="btn-card-del-page" data-del-pidx="${realIdx}" title="刪除此頁"
                              style="background:none; border:none; color:#94A3B8; font-size:12px; cursor:pointer; padding:0 2px;">🗑️</button>
                    </div>
                  </div>
                  <div id="thumb-slot-${p.id}" data-open-idx="${realIdx}" style="height:165px; display:flex; align-items:center; justify-content:center; cursor:pointer;">
                    ${cachedUrl
                      ? `<img src="${cachedUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                      : `<div style="text-align:center; color:#94A3B8; font-size:11px;">載入縮圖中...</div>`}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  host.querySelectorAll("[data-open-idx]").forEach(el => {
    el.onclick = () => { activePageIdx = Number(el.dataset.openIdx); renderWorkspace(); };
  });

  host.querySelectorAll(".btn-sp-add-page").forEach(btn => {
    btn.onclick = () => createAndOpenNewPage(btn.dataset.aspace, { docType: "度尺圖", withWhitePaper: false });
  });

  host.querySelectorAll(".btn-sp-add-blank").forEach(btn => {
    btn.onclick = () => createAndOpenNewPage(btn.dataset.bspace, { docType: "度尺圖", withWhitePaper: true });
  });

  host.querySelectorAll(".btn-card-del-page").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.delPidx);
      const target = allPages[idx];
      if (!target) return;
      if (!confirm(`確定刪除「${target.space || ""} · ${target.pageNum || ""}」嗎？`)) return;
      currentProject.pages.splice(idx, 1);
      currentProject.pages.forEach((pg, i) => { pg.pageNum = `P${i + 1}`; });
      await saveCurrentProject();
      renderOverview();
    };
  });

  host.querySelectorAll(".btn-card-cat-tap").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pg = allPages[Number(btn.dataset.pidx)];
      if (!pg) return;
      openQuickReassignModal(pg, allSpaces, () => renderOverview());
    };
  });

  host.querySelectorAll(".btn-quick-replace-measure").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); pendingReplaceSpace = btn.dataset.rspace; replaceInput.click(); };
  });

  host.querySelectorAll(".btn-quick-compare").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); compareSpaceName = btn.dataset.cspace; renderWorkspace(); };
  });

  const visiblePagesToLoad = sortedGroups.flatMap(([, items]) => items).filter(p => !(p.sitePhotoUrl || memoryPhotoCache.get(p.id)));
  (async () => {
    const batchSize = 6;
    for (let i = 0; i < visiblePagesToLoad.length; i += batchSize) {
      if (renderGen !== overviewRenderGeneration || activePageIdx >= 0 || compareSpaceName) return;
      const chunk = visiblePagesToLoad.slice(i, i + batchSize);
      await Promise.all(chunk.map(async (pg) => {
        const url = await ensureSinglePagePhoto(currentProject, pg);
        if (renderGen !== overviewRenderGeneration) return;
        const slot = document.getElementById(`thumb-slot-${pg.id}`);
        if (slot) {
          slot.innerHTML = url
            ? `<img src="${url}" style="width:100%; height:100%; object-fit:contain;" />`
            : `<div style="text-align:center; color:#64748B; font-size:11px;">空白頁 · 點擊開啟拍照或插白紙</div>`;
        }
      }));
    }
  })();
}

async function renderSideBySideCompare(spaceName) {
  const allPages = currentProject.pages || [];
  const spacePages = allPages.filter(p => (p.space || "未標空間") === spaceName);
  if (!spacePages.length) { compareSpaceName = null; renderOverview(); return; }

  let leftPage = spacePages.find(p => normalizePageCategory(p) === "度尺圖") || spacePages[0];
  let rightPage = spacePages.find(p => normalizePageCategory(p) !== "度尺圖") || spacePages[Math.min(1, spacePages.length - 1)];

  root.innerHTML = `
    <div style="position:fixed; inset:0; width:100vw; height:100vh; background:#F8FAFC; display:flex; flex-direction:column; z-index:920;">
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

      <div style="flex:1; display:grid; grid-template-columns:1fr 1fr; gap:4px; background:#E2E8F0; overflow:hidden;">
        <div style="background:#FFF; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 8px; background:#F0FDF4; border-bottom:1px solid #DCFCE7; font-size:11px;">
            <strong id="cmp-left-title" style="color:#166534;">左圖：${normalizePageCategory(leftPage)}</strong>
            <button id="btn-cmp-edit-left" style="background:#16A34A; color:#FFF; border:none; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700; cursor:pointer;">✏️ 全屏批改左圖</button>
          </div>
          <div id="cmp-left-body" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:6px;">
            <span style="color:#94A3B8; font-size:12px;">載入左圖中...</span>
          </div>
        </div>

        <div style="background:#FFF; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 8px; background:#EFF6FF; border-bottom:1px solid #DBEAFE; font-size:11px;">
            <strong id="cmp-right-title" style="color:#1D4ED8;">右圖：${normalizePageCategory(rightPage)}</strong>
            <button id="btn-cmp-edit-right" style="background:#2563EB; color:#FFF; border:none; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700; cursor:pointer;">✏️ 全屏批改右圖</button>
          </div>
          <div id="cmp-right-body" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:6px;">
            <span style="color:#94A3B8; font-size:12px;">載入右圖中...</span>
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
    if (lBody) lBody.innerHTML = lUrl ? `<img src="${lUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />` : `<span style="color:#94A3B8; font-size:12px;">此頁尚未上傳圖片</span>`;
    if (rBody) rBody.innerHTML = rUrl ? `<img src="${rUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />` : `<span style="color:#94A3B8; font-size:12px;">此頁尚未上傳圖片</span>`;
  };

  document.getElementById("btn-exit-compare").onclick = () => { compareSpaceName = null; renderOverview(); };
  document.getElementById("cmp-left-sel").onchange = (e) => { leftPage = spacePages[Number(e.target.value)]; renderBothImages(); };
  document.getElementById("cmp-right-sel").onchange = (e) => { rightPage = spacePages[Number(e.target.value)]; renderBothImages(); };
  document.getElementById("btn-cmp-edit-left").onclick = () => { compareSpaceName = null; activePageIdx = allPages.indexOf(leftPage); renderWorkspace(); };
  document.getElementById("btn-cmp-edit-right").onclick = () => { compareSpaceName = null; activePageIdx = allPages.indexOf(rightPage); renderWorkspace(); };

  await renderBothImages();
}

function renderProjectReviewList() {
  const host = document.getElementById("project-review-list");
  if (!host) return;
  const rows = [];
  (currentProject.pages || []).forEach((p, pIdx) => {
    (p.reviewLogs || []).forEach((log, lIdx) => rows.push({ p, pIdx, log, lIdx }));
  });

  if (!rows.length) {
    host.innerHTML = `<div style="color:#6B7280; padding:6px 0;">尚無審圖批改記錄。</div>`;
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

  host.querySelectorAll(".rev-jump-page").forEach(el => { el.onclick = () => { activePageIdx = Number(el.dataset.pidx); renderWorkspace(); }; });
  host.querySelectorAll(".rev-cycle-status").forEach(btn => {
    btn.onclick = async () => {
      const p = currentProject.pages[Number(btn.dataset.pidx)];
      const log = p?.reviewLogs?.[Number(btn.dataset.lidx)];
      if (!log) return;
      const cur = normalizeReviewStatus(log.status);
      log.status = STATUS_CYCLE_ORDER[(STATUS_CYCLE_ORDER.indexOf(cur) + 1) % STATUS_CYCLE_ORDER.length];
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
  const cabItems = masterDict?.cabinetGroups?.flatMap(g => g.items) || [];

  document.getElementById("picker-spaces").innerHTML = cloudPresetSpaces.map(spName =>
    `<button type="button" class="chip" data-sp="${spName}">${spName}</button>`
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
    await createAndOpenNewPage(spaceVal, { docType: docTypeVal, withWhitePaper: false });
  };
}

async function renderSinglePageEditor(page) {
  const totalPages = currentProject.pages.length;
  const catLabel = normalizePageCategory(page);
  const currentSpace = page.space || "未標空間";
  const allSpaces = [...new Set([...(currentProject.pages || []).map(p => p.space || "未標空間"), ...cloudPresetSpaces])].filter(Boolean);
  const sameSpacePages = (currentProject.pages || []).filter(p => (p.space || "未標空間") === currentSpace);
  if (!Array.isArray(page.reviewLogs)) page.reviewLogs = [];

  const rawColors = Array.isArray(masterDict?.rulerColors) ? masterDict.rulerColors : [];
  const paletteColors = rawColors.map(c => (typeof c === "string" ? c : (c?.hex || c?.color || c?.value || ""))).filter(Boolean);
  const finalColors = paletteColors.length ? paletteColors : ["#DC2626", "#2563EB", "#059669", "#9333EA", "#EA580C", "#111827"];

  root.innerHTML = `
    <div id="fullscreen-editor-shell" style="position:fixed; inset:0; width:100vw; height:100vh; background:#F8FAFC; display:flex; flex-direction:column; z-index:900; overflow:hidden;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; background:#FFFFFF; border-bottom:1px solid #E2E8F0; flex-wrap:wrap; gap:5px; z-index:20;">
        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
          <button id="btn-back-grid" style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">‹ 返回圖集</button>
          <strong style="font-size:13px; color:#0F172A;">${page.pageNum || `P${activePageIdx + 1}`}</strong>

          <select id="ed-space-sel" title="更改所屬空間" style="padding:3px 5px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700; color:#0F172A; background:#F8FAFC;">
            ${allSpaces.map(sp => `<option value="${sp}" ${sp === currentSpace ? "selected" : ""}>${sp}</option>`).join("")}
          </select>
          <select id="ed-cat-sel" title="更改圖紙分類" style="padding:3px 5px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700; color:#1D4ED8; background:#EFF6FF;">
            ${CORE_CATEGORIES.map(c => `<option value="${c}" ${c === catLabel ? "selected" : ""}>${c}</option>`).join("")}
          </select>
          <span style="font-size:11px; color:#64748B;">(${activePageIdx + 1}/${totalPages})</span>

          <button type="button" id="btn-ed-add-page" title="在目前空間新增一頁"
                  style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:800; cursor:pointer;">
            ➕ 加頁
          </button>
          <button type="button" id="btn-ed-del-page" title="刪除目前這一頁"
                  style="background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:800; cursor:pointer;">
            🗑️ 刪頁
          </button>

          <button type="button" id="btn-toggle-space-strip"
                  style="background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:800; cursor:pointer;">
            🗂️ 本區圖集 (${sameSpacePages.length}) ▾
          </button>
        </div>

        <div style="display:flex; align-items:center; gap:5px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:999px; padding:2px 8px;">
          <div id="top-color-dots" style="display:flex; align-items:center; gap:4px;">
            ${finalColors.map((c, idx) => `
              <button type="button" class="top-cdot" data-tcol="${c}"
                      style="width:16px; height:16px; border-radius:50%; background-color:${c}; border:${idx === 0 ? "2.5px solid #0F172A" : "1px solid #64748B"}; cursor:pointer; padding:0; flex-shrink:0;"></button>
            `).join("")}
          </div>

          <span style="color:#CBD5E1;">|</span>

          <label style="display:flex; align-items:center; gap:3px; font-size:11px; color:#334155; white-space:nowrap;">
            <span>幼細</span>
            <input type="range" id="top-stroke-slider" min="0.5" max="8" step="0.5" value="1.5" style="width:48px; accent-color:#2563EB;" />
            <span id="top-stroke-val" style="min-width:20px; font-weight:700;">1.5</span>
          </label>

          <button type="button" id="btn-top-reset-zoom" title="重置縮放置中" style="background:#FFF; border:1px solid #CBD5E1; border-radius:999px; padding:1px 7px; font-size:11px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap;">⊡ 置中</button>
        </div>

        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
          <button type="button" id="btn-top-arrow-mode" style="background:#FEF2F2; color:#DC2626; border:1.5px solid #FCA5A5; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">↗ 箭頭批改</button>
          <label style="background:#EFF6FF; color:#1D4ED8; border:1px solid #93C5FD; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:800; cursor:pointer;">
            📸 拍照 / 插圖
            <input type="file" id="up-site-photo" accept="image/*" class="hidden" />
          </label>
          <button id="btn-toggle-white-bg" style="background:#F8FAFC; color:#0F172A; border:1px solid #CBD5E1; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:800; cursor:pointer;">📄 插白紙</button>
          <button id="btn-page-review-drawer" style="background:#FFF; color:#991B1B; border:1px solid #FECACA; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:800; cursor:pointer;">
            📝 記錄 (${page.reviewLogs.length})
          </button>
          <span id="top-auto-save-status" style="font-size:11px; font-weight:800; color:#059669; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:999px; padding:3px 8px; white-space:nowrap;">☁️ 已自動儲存</span>
        </div>
      </div>

      <div id="ed-space-strip-drawer" class="hidden" style="background:rgba(255,255,255,0.96); border-bottom:1px solid #CBD5E1; padding:6px 10px; display:flex; align-items:center; gap:8px; overflow-x:auto; z-index:25; box-shadow:0 6px 16px rgba(15,23,42,0.08);">
        ${sameSpacePages.map(spPg => {
          const globalIdx = currentProject.pages.indexOf(spPg);
          const isCur = spPg === page;
          const cached = spPg.sitePhotoUrl || memoryPhotoCache.get(spPg.id) || "";
          return `
            <div class="strip-thumb-card" data-jump-idx="${globalIdx}"
                 style="flex-shrink:0; width:96px; border:2px solid ${isCur ? "#2563EB" : "#CBD5E1"}; border-radius:7px; background:${isCur ? "#EFF6FF" : "#F8FAFC"}; overflow:hidden; cursor:pointer;">
              <div style="font-size:10px; font-weight:800; padding:2px 5px; color:${isCur ? "#1D4ED8" : "#334155"}; background:#FFF; border-bottom:1px solid #E2E8F0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${spPg.pageNum || `P${globalIdx + 1}`} · ${normalizePageCategory(spPg)}
              </div>
              <div id="strip-img-${spPg.id}" style="height:56px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#94A3B8;">
                ${cached ? `<img src="${cached}" style="width:100%; height:100%; object-fit:contain;" />` : `載入中`}
              </div>
            </div>
          `;
        }).join("")}
        <button type="button" id="btn-close-space-strip" style="flex-shrink:0; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:6px; padding:4px 8px; font-size:11px; color:#475569; cursor:pointer;">收起 ▴</button>
      </div>

      <div id="page-review-drawer" class="hidden" style="position:absolute; right:10px; top:42px; bottom:10px; width:min(410px, 95vw); height:calc(100vh - 54px); background:#FFFFFF; color:#0F172A; border:1.5px solid #CBD5E1; border-radius:10px; padding:10px; box-shadow:0 12px 28px rgba(15,23,42,0.22); z-index:40; display:flex; flex-direction:column; gap:7px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:5px;">
          <strong style="font-size:14px; color:#0F172A;">📝 本頁審圖批改記錄</strong>
          <button id="btn-close-page-rev" style="background:none; border:none; color:#64748B; font-size:15px; cursor:pointer;">✕</button>
        </div>

        <div style="display:flex; gap:5px; align-items:center;">
          <select id="new-rev-status" style="padding:4px 7px; border-radius:5px; border:1px solid #CBD5E1; font-size:12px; font-weight:700;">
            <option value="NEED_FIX">❌ 需改</option>
            <option value="SITE_CHECK">⚠️ 再核對</option>
            <option value="NEED_INFO">📌 待補資料</option>
            <option value="OK">✅ 確認</option>
          </select>
          <button id="btn-drawer-cloud-dict" style="margin-left:auto; background:#EFF6FF; border:1px solid #93C5FD; border-radius:5px; padding:3px 8px; font-size:11px; font-weight:700; color:#1D4ED8; cursor:pointer;">⚙️ 管理雲端詞庫</button>
        </div>

        <textarea id="new-rev-note" rows="2" placeholder="輸入批改要求，或點下方雲端短語一鍵帶入..."
                  style="width:100%; box-sizing:border-box; padding:6px 8px; border-radius:6px; border:1.5px solid #93C5FD; font-size:12px; resize:none; font-family:inherit;"></textarea>

        <div id="drawer-phrase-chips" style="display:flex; flex-wrap:wrap; gap:4px; max-height:175px; overflow-y:auto; background:#F8FAFC; padding:5px; border-radius:6px; border:1px solid #E2E8F0;"></div>

        <button id="btn-add-rev-note" style="background:#2563EB; color:#FFF; border:none; border-radius:6px; padding:5px 10px; font-size:12px; font-weight:800; cursor:pointer;">
          + 新增批改記錄
        </button>

        <div id="page-rev-items" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:5px; font-size:12px; border-top:1px solid #E2E8F0; padding-top:6px;"></div>
      </div>

      <div id="sub-module-host" style="flex:1; width:100%; height:100%; position:relative; overflow:hidden; background:#F8FAFC;">
        <div style="color:#64748B; text-align:center; padding:50px; font-size:14px;">正在按需載入本頁底圖...</div>
      </div>
    </div>
  `;

  const saveAndRun = async (fn) => {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(false);
    await saveCurrentProject();
    fn();
  };

  document.getElementById("btn-ed-add-page").onclick = () => {
    saveAndRun(() => {
      createAndOpenNewPage(currentSpace, {
        docType: normalizePageCategory(page),
        withWhitePaper: false,
        insertAfterIdx: activePageIdx
      });
    });
  };

  document.getElementById("btn-ed-del-page").onclick = async () => {
    if (!confirm(`確定刪除目前這一頁（${page.pageNum || ""} · ${currentSpace}）嗎？`)) return;
    currentProject.pages.splice(activePageIdx, 1);
    currentProject.pages.forEach((pg, i) => { pg.pageNum = `P${i + 1}`; });
    await saveCurrentProject();
    if (currentProject.pages.length === 0) {
      activePageIdx = -1;
    } else if (activePageIdx >= currentProject.pages.length) {
      activePageIdx = currentProject.pages.length - 1;
    }
    renderWorkspace();
  };

  const stripToggleBtn = document.getElementById("btn-toggle-space-strip");
  const stripDrawer = document.getElementById("ed-space-strip-drawer");
  stripToggleBtn.onclick = async () => {
    const willOpen = stripDrawer.classList.contains("hidden");
    stripDrawer.classList.toggle("hidden");
    stripToggleBtn.textContent = willOpen ? `🗂️ 本區圖集 (${sameSpacePages.length}) ▴` : `🗂️ 本區圖集 (${sameSpacePages.length}) ▾`;
    if (willOpen) {
      for (const spPg of sameSpacePages) {
        const url = await ensureSinglePagePhoto(currentProject, spPg);
        const box = document.getElementById(`strip-img-${spPg.id}`);
        if (box) box.innerHTML = url ? `<img src="${url}" style="width:100%; height:100%; object-fit:contain;" />` : `無圖`;
      }
    }
  };
  document.getElementById("btn-close-space-strip").onclick = () => {
    stripDrawer.classList.add("hidden");
    stripToggleBtn.textContent = `🗂️ 本區圖集 (${sameSpacePages.length}) ▾`;
  };
  stripDrawer.querySelectorAll(".strip-thumb-card").forEach(card => {
    card.onclick = () => {
      const targetIdx = Number(card.dataset.jumpIdx);
      if (targetIdx === activePageIdx) return;
      saveAndRun(() => { activePageIdx = targetIdx; renderWorkspace(); });
    };
  });

  const topArrowBtn = document.getElementById("btn-top-arrow-mode");
  topArrowBtn.onclick = () => {
    if (!activeCanvasInstance) return;
    const nextMode = activeCanvasInstance.mode === "ARROW" ? "VIEW" : "ARROW";
    activeCanvasInstance.setMode(nextMode);
  };

  document.querySelectorAll(".top-cdot").forEach(dot => {
    dot.onclick = () => {
      const col = dot.dataset.tcol;
      document.querySelectorAll(".top-cdot").forEach(d => {
        d.style.border = d.dataset.tcol === col ? "2.5px solid #0F172A" : "1px solid #64748B";
      });
      if (activeCanvasInstance) activeCanvasInstance.setActiveColor(col);
    };
  });

  const topStrokeSlider = document.getElementById("top-stroke-slider");
  const topStrokeVal = document.getElementById("top-stroke-val");
  topStrokeSlider.oninput = () => {
    const v = parseFloat(topStrokeSlider.value);
    topStrokeVal.textContent = String(v);
    if (activeCanvasInstance) activeCanvasInstance.setStrokeWidth(v);
  };
  topStrokeSlider.onchange = () => {
    if (activeCanvasInstance && activeCanvasInstance.selectedItems.length) activeCanvasInstance.emitSave();
  };

  document.getElementById("btn-top-reset-zoom").onclick = () => {
    if (activeCanvasInstance) activeCanvasInstance.resetZoom();
  };

  document.getElementById("ed-space-sel").onchange = async (e) => {
    page.space = e.target.value;
    page.title = `${page.space} · ${normalizePageCategory(page)}`;
    await saveCurrentProject();
    renderSinglePageEditor(page);
  };

  document.getElementById("ed-cat-sel").onchange = async (e) => {
    page.docTypeLabel = e.target.value;
    page.title = `${page.space || "未標空間"} · ${page.docTypeLabel}`;
    await saveCurrentProject();
  };

  const renderDrawerPhrases = () => {
    const box = document.getElementById("drawer-phrase-chips");
    if (!box) return;
    box.innerHTML = cloudPhraseBank.slice(0, 24).map(p => `
      <button type="button" class="drw-phrase-chip" data-ptext="${p.text.replace(/"/g, "&quot;")}"
              style="background:#FFF; border:1px solid #CBD5E1; border-radius:4px; padding:3px 7px; font-size:11px; color:#334155; cursor:pointer; text-align:left;">
        ${p.text}
      </button>
    `).join("") || `<span style="font-size:11px; color:#94A3B8;">雲端尚無短語，點上方「⚙️ 管理雲端詞庫」新增或匯入範本。</span>`;
    box.querySelectorAll(".drw-phrase-chip").forEach(btn => {
      btn.onclick = () => {
        const inp = document.getElementById("new-rev-note");
        inp.value = inp.value ? `${inp.value} ${btn.dataset.ptext}` : btn.dataset.ptext;
        inp.focus();
      };
    });
  };
  renderDrawerPhrases();

  document.getElementById("btn-drawer-cloud-dict").onclick = () => openCloudDictModal("PHRASE", renderDrawerPhrases);

  const renderPageRevItems = () => {
    const listEl = document.getElementById("page-rev-items");
    const badgeBtn = document.getElementById("btn-page-review-drawer");
    if (badgeBtn) badgeBtn.textContent = `📝 記錄 (${page.reviewLogs.length})`;
    if (!listEl) return;
    if (!page.reviewLogs.length) {
      listEl.innerHTML = `<div style="color:#94A3B8; font-size:11px;">尚無批改記錄，可使用頂部「↗ 箭頭批改」拉線打字或在上方輸入。</div>`;
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

  document.getElementById("btn-page-review-drawer").onclick = () => document.getElementById("page-review-drawer").classList.toggle("hidden");
  document.getElementById("btn-close-page-rev").onclick = () => document.getElementById("page-review-drawer").classList.add("hidden");
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

  document.getElementById("btn-back-grid").onclick = () => {
    saveAndRun(() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      activePageIdx = -1;
      renderWorkspace();
    });
  };

  const host = document.getElementById("sub-module-host");

  const showMeasure = () => {
    if (!page.sitePhotoUrl) {
      host.innerHTML = `
        <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px;">
          <div style="font-size:15px; font-weight:800; color:#334155;">此頁尚未設定底圖，請選擇現場操作：</div>
          <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">
            <label style="background:#2563EB; color:#FFF; border-radius:10px; padding:12px 18px; font-size:14px; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.25);">
              📸 現場拍照 / 選底圖
              <input type="file" id="center-pick-photo" accept="image/*" class="hidden" />
            </label>
            <button type="button" id="center-open-blank"
                    style="background:#FFFFFF; color:#0F172A; border:1.5px solid #0F172A; border-radius:10px; padding:12px 18px; font-size:14px; font-weight:800; cursor:pointer;">
              📄 開白紙草圖
            </button>
          </div>
        </div>
      `;
      const centerPick = document.getElementById("center-pick-photo");
      if (centerPick) {
        centerPick.onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          host.innerHTML = `<div style="color:#475569; text-align:center; padding:50px;">正在儲存底圖...</div>`;
          const savedUrl = await savePhotoOfflineFirst(currentProject.id, page, f);
          page.sitePhotoUrl = savedUrl;
          memoryPhotoCache.set(page.id, savedUrl);
          await saveCurrentProject();
          showMeasure();
        };
      }
      const centerBlank = document.getElementById("center-open-blank");
      if (centerBlank) {
        centerBlank.onclick = async () => {
          page.sitePhotoUrl = createBlankWhiteDataUrl();
          memoryPhotoCache.set(page.id, page.sitePhotoUrl);
          await saveCurrentProject();
          showMeasure();
        };
      }
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
        stickers: page.stickers || [],
        overlays: page.overlays || []
      },
      finalColors,
      async (updated) => {
        page.lines = updated.lines || [];
        page.markers = updated.markers || [];
        if (updated.paths) page.paths = updated.paths;
        if (updated.arrows) page.arrows = updated.arrows;
        if (updated.stickers) page.stickers = updated.stickers;
        if (updated.overlays) page.overlays = updated.overlays;
        if (updated.newReviewNote) {
          const now = new Date();
          const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          page.reviewLogs.unshift({
            time: tStr,
            note: updated.newReviewNote,
            status: updated.newReviewStatus || "NEED_FIX"
          });
          renderPageRevItems();
        }
        await saveCurrentProject();
      },
      {
        hasPrev: activePageIdx > 0,
        hasNext: activePageIdx < totalPages - 1,
        getPhraseBank: () => cloudPhraseBank,
        getStampGroups: () => cloudStampGroups,
        onBaseImageMerged: async (mergedUrl) => {
          page.sitePhotoUrl = mergedUrl;
          memoryPhotoCache.set(page.id, mergedUrl);
          const refId = page.mediaRefId || `M_${currentProject.id}_${page.id}`;
          page.mediaRefId = refId;
          await idbSaveMedia(refId, mergedUrl, { projectId: currentProject.id, pageId: page.id });
          const mediaPayload = {
            projectId: currentProject.id,
            pageId: page.id,
            imageData: mergedUrl,
            updatedAt: Date.now()
          };
          if (!navigator.onLine) {
            await idbEnqueueSync({ type: "MEDIA", targetId: String(refId), payload: mediaPayload });
          } else {
            await setDoc(doc(db, MEDIA_COL, String(refId)), mediaPayload).catch(() =>
              idbEnqueueSync({ type: "MEDIA", targetId: String(refId), payload: mediaPayload })
            );
          }
          await saveCurrentProject();
        },
        onModeSync: (m) => {
          if (m === "ARROW") {
            topArrowBtn.style.background = "#DC2626";
            topArrowBtn.style.color = "#FFFFFF";
          } else {
            topArrowBtn.style.background = "#FEF2F2";
            topArrowBtn.style.color = "#DC2626";
          }
        },
        onOpenDictManager: (tab, cb) => openCloudDictModal(tab, () => {
          renderDrawerPhrases();
          if (typeof cb === "function") cb();
        }),
        onPrev: () => { if (activePageIdx > 0) saveAndRun(() => { activePageIdx--; renderWorkspace(); }); },
        onNext: () => { if (activePageIdx < totalPages - 1) saveAndRun(() => { activePageIdx++; renderWorkspace(); }); }
      }
    );
  };

  const whiteBtn = document.getElementById("btn-toggle-white-bg");
  whiteBtn.onclick = async () => {
    if (!activeCanvasInstance) {
      page.sitePhotoUrl = createBlankWhiteDataUrl();
      memoryPhotoCache.set(page.id, page.sitePhotoUrl);
      await saveCurrentProject();
      showMeasure();
      return;
    }
    const isWhite = activeCanvasInstance.toggleWhiteBackground();
    whiteBtn.style.background = isWhite ? "#FEF08A" : "#F8FAFC";
    whiteBtn.textContent = isWhite ? "🖼️ 還原底圖" : "📄 插白紙";
  };

  document.getElementById("up-site-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div style="color:#475569; text-align:center; padding:50px;">正在儲存底圖（支援離線本機儲存）...</div>`;
    const savedUrl = await savePhotoOfflineFirst(currentProject.id, page, file);
    page.sitePhotoUrl = savedUrl;
    memoryPhotoCache.set(page.id, savedUrl);
    await saveCurrentProject();
    showMeasure();
  };

  await ensureSinglePagePhoto(currentProject, page);
  showMeasure();
}
