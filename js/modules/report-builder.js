import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "../config/firebase-init.js";

const REPORT_COL = (COLLECTIONS && COLLECTIONS.REPORTS_PUBLIC) || "measuring_reports_public";

function normalizeCat(p) {
  const raw = String(p?.docTypeLabel || p?.docType || "").trim();
  if (raw === "平面圖" || raw === "plan") return "平面圖";
  if (raw === "效果圖" || raw === "render") return "效果圖";
  if (raw === "繪圖" || raw === "立體圖" || raw === "詳圖" || raw === "3d" || raw === "detail") return "繪圖";
  return "度尺圖";
}

function buildAnnotatedPreviewDataUrl(page) {
  return new Promise((resolve) => {
    const src = page?.sitePhotoUrl || "";
    if (!src) {
      resolve("");
      return;
    }
    const hasAnnotations =
      (page.lines && page.lines.length) ||
      (page.markers && page.markers.length) ||
      (page.paths && page.paths.length) ||
      (page.arrows && page.arrows.length) ||
      (page.stickers && page.stickers.length) ||
      (page.overlays && page.overlays.length);

    if (!hasAnnotations) {
      resolve(src);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxW = 960;
      const sc = Math.min(1, maxW / Math.max(1, img.naturalWidth || 960));
      const w = Math.round((img.naturalWidth || 960) * sc);
      const h = Math.round((img.naturalHeight || 720) * sc);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      ctx.save();
      ctx.scale(sc, sc);

      (page.paths || []).forEach(p => {
        if (!p.points || p.points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = p.color || "#DC2626";
        ctx.lineWidth = Math.max(2, (p.strokeWidth || 2) * 1.5);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y);
        ctx.stroke();
        ctx.restore();
      });

      const drawPill = (ix, iy, text, bg, fg, fontPx = 22) => {
        if (!text) return;
        ctx.save();
        ctx.font = `800 ${fontPx}px sans-serif`;
        const lines = String(text).split("\n");
        const maxTw = Math.max(...lines.map(l => ctx.measureText(l).width), 28);
        const padX = 12;
        const padY = 7;
        const lineH = fontPx * 1.25;
        const bw = maxTw + padX * 2;
        const bh = lines.length * lineH + padY * 2;
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(ix - bw / 2, iy - bh / 2, bw, bh, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = bg;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        lines.forEach((ln, idx) => ctx.fillText(ln, ix, iy - bh / 2 + padY + lineH * (idx + 0.5)));
        ctx.restore();
      };

      (page.lines || []).forEach(l => {
        ctx.save();
        ctx.strokeStyle = l.color || "#2563EB";
        ctx.lineWidth = Math.max(2.5, (l.strokeWidth || 2) * 1.6);
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        ctx.fillStyle = l.color || "#2563EB";
        ctx.beginPath();
        ctx.arc(l.x1, l.y1, 5, 0, Math.PI * 2);
        ctx.arc(l.x2, l.y2, 5, 0, Math.PI * 2);
        ctx.fill();
        if (l.text) drawPill((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2, l.text, "#FFFFFF", l.color || "#2563EB", 22);
        ctx.restore();
      });

      (page.arrows || []).forEach(a => {
        ctx.save();
        const col = a.color || "#DC2626";
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = Math.max(2.5, (a.strokeWidth || 2) * 1.6);
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
        const ang = Math.atan2(a.y1 - a.y2, a.x1 - a.x2);
        const headLen = 18;
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x1 - headLen * Math.cos(ang - Math.PI / 6), a.y1 - headLen * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(a.x1 - headLen * Math.cos(ang + Math.PI / 6), a.y1 - headLen * Math.sin(ang + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        if (a.text) drawPill(a.x2, a.y2, a.text, col, "#FFFFFF", 22);
        ctx.restore();
      });

      (page.markers || []).forEach(m => {
        if (!m.text) return;
        drawPill(m.x, m.y, m.text, "#FFFFFF", m.color || "#DC2626", 24);
      });

      (page.stickers || []).forEach(s => {
        drawPill(s.x, s.y, s.label || "", s.bg || "#DC2626", s.color || "#FFFFFF", 22);
      });

      ctx.restore();
      resolve(c.toDataURL("image/jpeg", 0.68));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

async function buildCleanSnapshot(project, chosenPages, opts, onProgress) {
  const snapshotPages = [];
  for (let i = 0; i < chosenPages.length; i++) {
    const p = chosenPages[i];
    if (onProgress) onProgress(i + 1, chosenPages.length, p);
    const mergedImg = opts.includePhotos ? await buildAnnotatedPreviewDataUrl(p) : "";
    const dimList = opts.includeDims
      ? [
          ...(Array.isArray(p.lines) ? p.lines : []).map(l => String(l?.text || "").trim()),
          ...(Array.isArray(p.markers) ? p.markers : []).map(m => String(m?.text || "").trim())
        ].filter(Boolean)
      : [];
    const logs = opts.includeIssues && Array.isArray(p.reviewLogs)
      ? p.reviewLogs
          .filter(r => r && typeof r === "object" && !Array.isArray(r))
          .map(r => ({
            note: String(r.note || "").trim(),
            status: String(r.status || "NEED_FIX"),
            time: String(r.time || "")
          }))
          .filter(r => r.note)
      : [];

    snapshotPages.push({
      id: String(p.id || `pg_${i}`),
      pageNum: String(p.pageNum || `P${i + 1}`),
      space: String(p.space || "未標空間"),
      category: String(normalizeCat(p)),
      imageUrl: String(mergedImg || ""),
      dimensions: dimList,
      reviewLogs: logs
    });
  }

  return {
    projectId: String(project.id || ""),
    projectName: String(project.name || "工程報告"),
    updatedAt: Date.now(),
    includeDims: Boolean(opts.includeDims),
    includeIssues: Boolean(opts.includeIssues),
    includePhotos: Boolean(opts.includePhotos),
    pages: snapshotPages
  };
}

function renderFormattedReportSheetView(container, data, onCloseAction) {
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const dt = data.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-HK") : "";

  const groups = new Map();
  pages.forEach(p => {
    const sp = p.space || "未標空間";
    if (!groups.has(sp)) groups.set(sp, []);
    groups.get(sp).push(p);
  });

  const flatOrderedPages = Array.from(groups.entries()).flatMap(([sp, items]) =>
    items.map(pg => ({ ...pg, spaceTitle: sp }))
  );

  const pairedSheets = [];
  for (let i = 0; i < flatOrderedPages.length; i += 2) {
    pairedSheets.push(flatOrderedPages.slice(i, i + 2));
  }

  let layoutMode = "PORTRAIT_2IN1"; // "PORTRAIT_2IN1" | "LANDSCAPE_1IN1"

  const renderView = () => {
    const isLandscape = layoutMode === "LANDSCAPE_1IN1";
    const sheets = isLandscape ? flatOrderedPages.map(pg => [pg]) : pairedSheets;

    container.innerHTML = `
      <style>
        @page {
          size: ${isLandscape ? "A4 landscape" : "A4 portrait"};
          margin: 2mm;
        }
        @media print {
          html, body {
            background: #FFFFFF !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          header, nav, .navbar, .topbar, .no-print, #offline-status-pill {
            display: none !important;
          }
          .rpt-root-wrap {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .rpt-a4-sheet {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: #FFFFFF !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .rpt-a4-sheet:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .rpt-half-slot {
            display: block !important;
            width: 100% !important;
            height: ${isLandscape ? "202mm" : "143mm"} !important;
            margin: 0 0 ${isLandscape ? "0" : "1.5mm"} 0 !important;
            padding: 2px 3px !important;
            border: 0.4pt solid #CBD5E1 !important;
            border-radius: 2px !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            background: #FFFFFF !important;
          }
          .rpt-half-slot:last-child {
            margin-bottom: 0 !important;
          }
          .rpt-slot-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            height: 4.5mm !important;
            border-bottom: 0.4pt solid #E2E8F0 !important;
            margin-bottom: 1mm !important;
            padding: 0 2px !important;
          }
          .rpt-half-img {
            display: block !important;
            width: 100% !important;
            height: ${isLandscape ? "188mm" : "128mm"} !important;
            max-height: ${isLandscape ? "188mm" : "128mm"} !important;
            object-fit: contain !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
          }
          .rpt-meta-bar {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 2px !important;
            align-items: center !important;
            margin-top: 0.8mm !important;
            max-height: 7mm !important;
            overflow: hidden !important;
          }
        }
      </style>

      <div class="rpt-root-wrap" style="width:100%; max-width:100%; margin:0; padding:4px 6px; box-sizing:border-box; display:flex; flex-direction:column; gap:6px;">
        <div class="no-print" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; background:#FFFFFF; border:1px solid #CBD5E1; border-top:3px solid #0F172A; border-radius:6px; padding:6px 10px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <button type="button" id="rpt-view-close-btn" class="btn-outline btn-sm" style="font-weight:800;">✕ 關閉</button>
            <div>
              <strong style="font-size:15px; color:#0F172A;">${data.projectName || "現場度尺與審圖報告"}</strong>
              <span style="font-size:11px; color:#64748B; margin-left:6px;">共 ${pages.length} 張 · 排為 ${sheets.length} 頁 PDF · ${dt}</span>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <div style="display:inline-flex; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:6px; padding:2px;">
              <button type="button" id="rpt-mode-portrait"
                      style="border:none; border-radius:4px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer; background:${!isLandscape ? "#0F172A" : "transparent"}; color:${!isLandscape ? "#FFF" : "#475569"};">
                直向 2合1
              </button>
              <button type="button" id="rpt-mode-landscape"
                      style="border:none; border-radius:4px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer; background:${isLandscape ? "#0F172A" : "transparent"}; color:${isLandscape ? "#FFF" : "#475569"};">
                橫向 1/1
              </button>
            </div>

            <button type="button" id="rpt-export-pdf-btn" class="btn-solid btn-sm" style="background:#0F172A; border-color:#0F172A;">
              📥 輸出 PDF
            </button>
          </div>
        </div>

        ${sheets.map((pair, sheetIdx) => `
          <div class="rpt-a4-sheet" style="width:100%; display:flex; flex-direction:column; gap:4px; padding:2px; background:#FFFFFF;">
            ${pair.map(pg => `
              <div class="rpt-half-slot" style="width:100%; border:0.5pt solid #CBD5E1; border-radius:3px; padding:2px 4px; box-sizing:border-box; background:#FFFFFF; display:flex; flex-direction:column; gap:2px;">
                <div class="rpt-slot-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:0.4pt solid #E2E8F0; padding:1px 2px;">
                  <strong style="font-size:11px; color:#0F172A;">${pg.spaceTitle} · ${pg.pageNum || ""}（${pg.category || ""}）</strong>
                  <span style="font-size:10px; color:#64748B;">${sheetIdx + 1}/${sheets.length}</span>
                </div>
                ${pg.imageUrl ? `<img class="rpt-half-img" src="${pg.imageUrl}" style="width:100%; max-height:${isLandscape ? "76vh" : "46vh"}; object-fit:contain; background:#FFF; display:block;" />` : ""}
                ${(pg.dimensions && pg.dimensions.length) ? `
                  <div class="rpt-meta-bar" style="display:flex; flex-wrap:wrap; gap:3px; align-items:center; padding:1px 2px;">
                    <span style="font-size:10px; font-weight:800; color:#1D4ED8;">尺寸：</span>
                    ${pg.dimensions.map(d => `<span style="background:#EFF6FF; color:#1E40AF; border:0.4pt solid #BFDBFE; border-radius:2px; padding:0 4px; font-size:10px; font-weight:700;">${d}</span>`).join("")}
                  </div>
                ` : ""}
                ${(pg.reviewLogs && pg.reviewLogs.length) ? `
                  <div class="rpt-meta-bar" style="display:flex; flex-wrap:wrap; gap:3px; align-items:center; padding:1px 2px;">
                    <span style="font-size:10px; font-weight:800; color:#991B1B;">確認：</span>
                    ${pg.reviewLogs.map(r => `<span style="background:#FEF2F2; border:0.4pt solid #FECACA; color:#991B1B; border-radius:2px; padding:0 4px; font-size:10px; font-weight:700;">${r.note}</span>`).join("")}
                  </div>
                ` : ""}
              </div>
            `).join("")}
          </div>
        `).join("")}
      </div>
    `;

    container.querySelector("#rpt-mode-portrait").onclick = () => {
      layoutMode = "PORTRAIT_2IN1";
      renderView();
    };
    container.querySelector("#rpt-mode-landscape").onclick = () => {
      layoutMode = "LANDSCAPE_1IN1";
      renderView();
    };

    container.querySelector("#rpt-view-close-btn").onclick = () => {
      if (typeof onCloseAction === "function") {
        onCloseAction();
      } else {
        window.close();
        setTimeout(() => {
          if (window.history.length > 1) window.history.back();
          else window.location.href = window.location.origin + window.location.pathname;
        }, 120);
      }
    };

    container.querySelector("#rpt-export-pdf-btn").onclick = () => {
      const prevTitle = document.title;
      const suffix = isLandscape ? "橫向1-1" : "直向2合1";
      document.title = `${data.projectName || "度尺報告"}_${suffix}`;
      window.print();
      setTimeout(() => { document.title = prevTitle; }, 500);
    };
  };

  renderView();
}

export function renderReportBuilder(container, project, onBack) {
  const pages = Array.isArray(project?.pages) ? project.pages : [];
  const selectedIds = new Set(pages.map(p => p.id));
  let includeDims = true;
  let includeIssues = true;
  let includePhotos = true;
  let latestShareUrl = "";

  const groupsMap = new Map();
  pages.forEach((p, idx) => {
    const sp = p.space || "未標空間";
    if (!groupsMap.has(sp)) groupsMap.set(sp, []);
    groupsMap.get(sp).push({ page: p, idx });
  });

  const renderUI = () => {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px; max-width:1100px; margin:0 auto;">
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong style="font-size:16px; color:#0F172A;">📋 報告自訂勾選與客戶預覽 · ${project.name || ""}</strong>
            <div style="font-size:12px; color:#64748B; margin-top:2px;">直接點擊下方縮圖卡片即可勾選或取消，已選 <strong>${selectedIds.size}</strong> / ${pages.length} 張</div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button id="rb-preview-pdf-btn" class="btn-solid btn-sm" style="background:#0F172A; border-color:#0F172A;">📥 預覽與輸出 PDF（2合1 / 橫向）</button>
            <button id="rb-back-btn" class="btn-outline btn-sm">‹ 返回工程</button>
          </div>
        </div>

        <div class="card" style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
            <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:700; cursor:pointer;">
              <input type="checkbox" id="rb-chk-dims" ${includeDims ? "checked" : ""} /> 包含現場尺寸標註清單
            </label>
            <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:700; cursor:pointer;">
              <input type="checkbox" id="rb-chk-issues" ${includeIssues ? "checked" : ""} /> 包含審圖批改問題卡
            </label>
            <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:700; cursor:pointer;">
              <input type="checkbox" id="rb-chk-photos" ${includePhotos ? "checked" : ""} /> 包含現場實測標註圖片
            </label>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; border-top:1px solid #E2E8F0; padding-top:8px;">
            <span style="font-size:12px; font-weight:800; color:#475569;">快捷篩選：</span>
            <button type="button" id="rb-sel-all" class="btn-outline btn-sm">✅ 全選 (${pages.length})</button>
            <button type="button" id="rb-sel-none" class="btn-outline btn-sm">⬜ 全不選</button>
            <button type="button" id="rb-sel-measure" class="btn-outline btn-sm" style="color:#1D4ED8; border-color:#93C5FD;">📐 只選度尺圖</button>
            <button type="button" id="rb-sel-issues" class="btn-outline btn-sm" style="color:#DC2626; border-color:#FCA5A5;">⚠️ 只選有批改問題頁</button>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; border-top:1px solid #E2E8F0; padding-top:8px;">
            <button type="button" id="rb-gen-link-btn" class="btn-outline btn-sm" style="color:#1D4ED8; border-color:#93C5FD; font-weight:800;">
              🔗 生成客戶專用雲端短網址（供 WhatsApp 傳送）
            </button>
            <span id="rb-gen-status" style="font-size:12px; color:#059669; font-weight:700;"></span>
          </div>

          <div id="rb-link-result" class="${latestShareUrl ? "" : "hidden"}" style="background:#EFF6FF; border:1.5px solid #3B82F6; border-radius:8px; padding:9px; display:flex; flex-direction:column; gap:6px;">
            <strong style="font-size:12px; color:#1E40AF;">✅ 已生成雲端唯讀報告短連結（手機／電腦皆可直接打開）：</strong>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <input type="text" id="rb-share-url" readonly value="${latestShareUrl}"
                     style="flex:1; min-width:220px; padding:6px 8px; border:1px solid #93C5FD; border-radius:6px; font-size:12px; background:#FFF; color:#0F172A;" />
              <button type="button" id="rb-copy-btn" class="btn-solid btn-sm">📋 複製連結</button>
              <a id="rb-open-preview-btn" href="${latestShareUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline btn-sm" style="text-decoration:none; font-weight:800;">👁️ 開啟預覽</a>
              <a id="rb-wa-share-btn" href="https://wa.me/?text=${encodeURIComponent(`${project.name || "工程"} - 現場度尺與審圖報告：${latestShareUrl}`)}" target="_blank" rel="noopener noreferrer" class="btn-outline btn-sm" style="text-decoration:none; color:#16A34A; border-color:#86EFAC; font-weight:800;">💬 WhatsApp 發給客戶</a>
            </div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
          ${Array.from(groupsMap.entries()).map(([spaceName, items]) => `
            <div class="card" style="padding:10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <strong style="font-size:14px; color:#0F172A;">📍 ${spaceName}（${items.filter(x => selectedIds.has(x.page.id)).length}/${items.length}張已選）</strong>
                <button type="button" class="rb-toggle-space btn-outline btn-sm" data-rbspace="${spaceName}" style="font-size:11px;">全選/取消本區</button>
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(175px, 1fr)); gap:8px;">
                ${items.map(({ page, idx }) => {
                  const checked = selectedIds.has(page.id);
                  const cat = normalizeCat(page);
                  const annCount = (page.lines || []).length + (page.markers || []).length + (page.arrows || []).length;
                  const logCount = (page.reviewLogs || []).length;
                  return `
                    <div class="rb-thumb-card" data-pid="${page.id}"
                         style="border:2px solid ${checked ? "#2563EB" : "#E2E8F0"}; background:${checked ? "#EFF6FF" : "#F8FAFC"}; border-radius:8px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; transition:all 0.12s;">
                      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 7px; background:${checked ? "#DBEAFE" : "#FFF"}; border-bottom:1px solid #E2E8F0; font-size:11px;">
                        <label style="display:flex; align-items:center; gap:4px; font-weight:800; color:#0F172A; cursor:pointer; pointer-events:none;">
                          <input type="checkbox" ${checked ? "checked" : ""} />
                          <span>${page.pageNum || `P${idx + 1}`} · ${cat}</span>
                        </label>
                        <div style="display:flex; gap:3px;">
                          ${annCount > 0 ? `<span style="background:#2563EB; color:#FFF; border-radius:4px; padding:0 4px; font-size:10px;">📐${annCount}</span>` : ""}
                          ${logCount > 0 ? `<span style="background:#DC2626; color:#FFF; border-radius:4px; padding:0 4px; font-size:10px;">📝${logCount}</span>` : ""}
                        </div>
                      </div>
                      <div style="height:125px; display:flex; align-items:center; justify-content:center; background:#FFF; padding:3px;">
                        ${page.sitePhotoUrl
                          ? `<img src="${page.sitePhotoUrl}" style="width:100%; height:100%; object-fit:contain;" />`
                          : `<span style="font-size:11px; color:#94A3B8;">尚無底圖</span>`}
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;

    container.querySelector("#rb-back-btn").onclick = () => onBack();
    container.querySelector("#rb-chk-dims").onchange = (e) => { includeDims = e.target.checked; };
    container.querySelector("#rb-chk-issues").onchange = (e) => { includeIssues = e.target.checked; };
    container.querySelector("#rb-chk-photos").onchange = (e) => { includePhotos = e.target.checked; };

    container.querySelector("#rb-preview-pdf-btn").onclick = async () => {
      const chosenPages = pages.filter(p => selectedIds.has(p.id));
      if (!chosenPages.length) {
        alert("請至少勾選一張圖紙再輸出 PDF！");
        return;
      }
      const btn = container.querySelector("#rb-preview-pdf-btn");
      const statusEl = container.querySelector("#rb-gen-status");
      btn.disabled = true;
      btn.textContent = "⏳ 正在排版...";
      const snapshotData = await buildCleanSnapshot(
        project,
        chosenPages,
        { includeDims, includeIssues, includePhotos },
        (cur, tot, p) => { statusEl.textContent = `正在合成標註圖 (${cur}/${tot})：${p.space || ""} ${p.pageNum || ""}...`; }
      );
      renderFormattedReportSheetView(container, snapshotData, () => renderUI());
    };

    container.querySelector("#rb-sel-all").onclick = () => {
      pages.forEach(p => selectedIds.add(p.id));
      renderUI();
    };
    container.querySelector("#rb-sel-none").onclick = () => {
      selectedIds.clear();
      renderUI();
    };
    container.querySelector("#rb-sel-measure").onclick = () => {
      selectedIds.clear();
      pages.forEach(p => {
        if (normalizeCat(p) === "度尺圖" || (p.lines && p.lines.length)) selectedIds.add(p.id);
      });
      renderUI();
    };
    container.querySelector("#rb-sel-issues").onclick = () => {
      selectedIds.clear();
      pages.forEach(p => {
        if ((p.reviewLogs && p.reviewLogs.length) || (p.arrows && p.arrows.length)) selectedIds.add(p.id);
      });
      renderUI();
    };

    container.querySelectorAll(".rb-toggle-space").forEach(btn => {
      btn.onclick = () => {
        const sp = btn.dataset.rbspace;
        const spItems = (groupsMap.get(sp) || []).map(x => x.page.id);
        const allChecked = spItems.every(id => selectedIds.has(id));
        spItems.forEach(id => {
          if (allChecked) selectedIds.delete(id);
          else selectedIds.add(id);
        });
        renderUI();
      };
    });

    container.querySelectorAll(".rb-thumb-card").forEach(card => {
      card.onclick = () => {
        const pid = card.dataset.pid;
        if (selectedIds.has(pid)) selectedIds.delete(pid);
        else selectedIds.add(pid);
        renderUI();
      };
    });

    const copyBtn = container.querySelector("#rb-copy-btn");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const inp = container.querySelector("#rb-share-url");
        inp.select();
        await navigator.clipboard.writeText(inp.value).catch(() => {});
        copyBtn.textContent = "✅ 已複製！";
        setTimeout(() => { copyBtn.textContent = "📋 複製連結"; }, 2000);
      };
    }

    container.querySelector("#rb-gen-link-btn").onclick = async () => {
      const chosenPages = pages.filter(p => selectedIds.has(p.id));
      if (!chosenPages.length) {
        alert("請至少勾選一張圖紙再生成連結！");
        return;
      }
      const btn = container.querySelector("#rb-gen-link-btn");
      const statusEl = container.querySelector("#rb-gen-status");
      btn.disabled = true;
      btn.textContent = "⏳ 正在合成並上傳雲端短網址...";
      statusEl.textContent = "";

      try {
        const token = "RPT_" + Date.now().toString(36).toUpperCase();
        const snapshotData = await buildCleanSnapshot(
          project,
          chosenPages,
          { includeDims, includeIssues, includePhotos },
          (cur, tot, p) => { statusEl.textContent = `正在處理 (${cur}/${tot})：${p.space || ""} ${p.pageNum || ""}...`; }
        );

        await setDoc(doc(db, REPORT_COL, token), snapshotData);

        const baseUrl = window.location.origin + window.location.pathname;
        latestShareUrl = `${baseUrl}?share=${encodeURIComponent(token)}`;
        renderUI();
      } catch (err) {
        alert("生成雲端報告連結失敗：" + (err?.message || err));
        btn.disabled = false;
        btn.textContent = "🔗 生成客戶專用雲端短網址（供 WhatsApp 傳送）";
      }
    };
  };

  renderUI();
}

export async function renderPublicShareReportView(container, token) {
  container.innerHTML = `<div class="card" style="text-align:center; padding:40px; font-size:15px;">正在載入現場度尺與審圖報告...</div>`;
  try {
    const snap = await getDoc(doc(db, REPORT_COL, String(token)));
    if (!snap.exists()) {
      container.innerHTML = `<div class="card" style="text-align:center; padding:40px; color:#DC2626; font-weight:700;">找不到此報告連結或連結已過期。</div>`;
      return;
    }
    renderFormattedReportSheetView(container, snap.data(), null);
  } catch (err) {
    container.innerHTML = `<div class="card" style="text-align:center; padding:40px; color:#DC2626;">載入報告失敗：${err?.message || err}</div>`;
  }
}
