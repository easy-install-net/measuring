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
    <div class="card" style="display:flex; gap:8px;">
      <input type="text" id="new-proj-name" placeholder="輸入新工程名稱（如：擎天半島 5-36G）"
             style="flex:1; padding:8px; border:1px solid #111827; border-radius:4px; font-size:15px;" />
      <button id="btn-create-proj" class="btn-solid">+ 建立工程</button>
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
      `).join("") || `<div class="card" style="color:#6B7280;">尚未建立工程，請在上方輸入單位名稱開始。</div>`}
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

  root.querySelectorAll("[data-id]").forEach(card => {
    card.onclick = () => {
      const found = projects.find(p => p.id === card.dataset.id);
      if (found) openProject(found);
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

function
