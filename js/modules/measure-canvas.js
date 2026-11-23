const ARROW_STATUS_BUTTONS = [
  { key: "OK", label: "✅ 確認無誤", bg: "#DCFCE7", fg: "#166534", border: "#86EFAC" },
  { key: "NEED_FIX", label: "❌ 需修改", bg: "#FEE2E2", fg: "#991B1B", border: "#FCA5A5" },
  { key: "SITE_CHECK", label: "⚠️ 現場核對", bg: "#FEF3C7", fg: "#92400E", border: "#FCD34D" },
  { key: "NEED_INFO", label: "📌 待補資料", bg: "#DBEAFE", fg: "#1E40AF", border: "#93C5FD" }
];

const FALLBACK_COLORS = ["#DC2626", "#2563EB", "#059669", "#9333EA", "#EA580C", "#111827", "#EAB308", "#FFFFFF"];

function normalizeColorList(rawColors) {
  if (!Array.isArray(rawColors) || !rawColors.length) return FALLBACK_COLORS;
  const parsed = rawColors.map(c => {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") return c.hex || c.color || c.value || c.code || "";
    return "";
  }).filter(Boolean);
  return parsed.length ? parsed : FALLBACK_COLORS;
}

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, colors, onChange, navOpts = {}) {
    this.container = container;
    this.imageUrl = imageUrl;
    this.lines = Array.isArray(initialData?.lines) ? initialData.lines : [];
    this.markers = Array.isArray(initialData?.markers) ? initialData.markers : [];
    this.paths = Array.isArray(initialData?.paths) ? initialData.paths : [];
    this.arrows = Array.isArray(initialData?.arrows) ? initialData.arrows : [];
    this.stickers = Array.isArray(initialData?.stickers) ? initialData.stickers : [];
    this.overlays = Array.isArray(initialData?.overlays) ? initialData.overlays : [];
    this.overlayImageCache = new Map();
    this.colors = normalizeColorList(colors);
    this.onChange = onChange;
    this.navOpts = navOpts;

    this.mode = "VIEW"; // VIEW | SELECT | ARROW | RULER | PEN | TEXT | STAMP | OVERLAY | ERASER
    this.activeColor = this.colors[0] || "#DC2626";
    this.strokeWidth = 1.5;
    this.fontSize = 18;
    this.whiteBg = false;
    this.selectedItem = null;
    this.undoStack = [];

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.isDrawing = false;
    this.draftObj = null;
    this.dragTarget = null;
    this.lastTapTime = 0;
    this.lastTapPos = null;
    this.pinchDist = 0;

    this.activeStampCatIdx = 0;
    this.selectedStampLabel = "";
    this.activePhraseCat = "全部";
    this.pendingArrowAction = null;
    this.pendingPlainTextAction = null;
    this.selectedArrowStatus = "NEED_FIX";

    this.bgImg = new Image();
    this.bgImg.crossOrigin = "anonymous";
    this.bgImg.onload = () => {
      this.fitImageToScreen();
      this.render();
    };
    this.bgImg.src = imageUrl;

    this.buildDOM();
    this.bindEvents();
  }

  getPhraseBank() {
    return typeof this.navOpts.getPhraseBank === "function" ? (this.navOpts.getPhraseBank() || []) : [];
  }

  getStampGroups() {
    return typeof this.navOpts.getStampGroups === "function" ? (this.navOpts.getStampGroups() || []) : [];
  }

  getOverlayImageElement(src) {
    if (!src) return null;
    if (this.overlayImageCache.has(src)) return this.overlayImageCache.get(src);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => this.render();
    img.src = src;
    this.overlayImageCache.set(src, img);
    return img;
  }

  addPhotoOverlay(dataUrl) {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      this.pushUndoSnapshot();
      const baseW = this.bgImg?.naturalWidth || 1200;
      const baseH = this.bgImg?.naturalHeight || 900;
      const targetW = Math.min(baseW * 0.36, img.naturalWidth || 400);
      const ratio = (img.naturalHeight || 300) / Math.max(1, img.naturalWidth || 400);
      const targetH = targetW * ratio;
      this.overlays.push({
        x: baseW * 0.5,
        y: baseH * 0.5,
        w: targetW,
        h: targetH,
        src: dataUrl
      });
      this.overlayImageCache.set(dataUrl, img);
      this.selectedItem = { type: "overlay", index: this.overlays.length - 1 };
      this.setMode("SELECT");
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };
    img.src = dataUrl;
  }

  // 一鍵將貼圖（單張或全部）合併壓進底圖並儲存
  async flattenOverlaysIntoBase(onlyIndex = -1) {
    if (!this.overlays.length) return;
    const baseW = this.bgImg?.naturalWidth || 1600;
    const baseH = this.bgImg?.naturalHeight || 1200;
    const off = document.createElement("canvas");
    off.width = baseW;
    off.height = baseH;
    const octx = off.getContext("2d");

    if (this.whiteBg) {
      octx.fillStyle = "#FFFFFF";
      octx.fillRect(0, 0, baseW, baseH);
    } else if (this.bgImg && this.bgImg.complete && this.bgImg.naturalWidth) {
      octx.drawImage(this.bgImg, 0, 0, baseW, baseH);
    }

    const toMerge = onlyIndex >= 0 ? [this.overlays[onlyIndex]] : [...this.overlays];
    for (const ov of toMerge) {
      if (!ov || !ov.src) continue;
      const im = this.getOverlayImageElement(ov.src);
      if (im && im.complete && im.naturalWidth) {
        octx.save();
        octx.drawImage(im, ov.x - ov.w / 2, ov.y - ov.h / 2, ov.w, ov.h);
        octx.strokeStyle = "#94A3B8";
        octx.lineWidth = 3;
        octx.strokeRect(ov.x - ov.w / 2, ov.y - ov.h / 2, ov.w, ov.h);
        octx.restore();
      }
    }

    const mergedDataUrl = off.toDataURL("image/jpeg", 0.88);
    if (onlyIndex >= 0) this.overlays.splice(onlyIndex, 1);
    else this.overlays = [];

    this.selectedItem = null;
    this.updateNearToolbar();
    this.imageUrl = mergedDataUrl;
    this.bgImg = new Image();
    this.bgImg.onload = () => this.render();
    this.bgImg.src = mergedDataUrl;

    if (typeof this.navOpts.onBaseImageMerged === "function") {
      await this.navOpts.onBaseImageMerged(mergedDataUrl);
    }
    this.emitSave();
  }

  pushUndoSnapshot() {
    const snap = JSON.stringify({
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      arrows: this.arrows,
      stickers: this.stickers,
      overlays: this.overlays
    });
    this.undoStack.push(snap);
    if (this.undoStack.length > 35) this.undoStack.shift();
    this.updateUndoButtonState();
  }

  undo() {
    if (!this.undoStack.length) return;
    const prev = JSON.parse(this.undoStack.pop());
    this.lines = prev.lines || [];
    this.markers = prev.markers || [];
    this.paths = prev.paths || [];
    this.arrows = prev.arrows || [];
    this.stickers = prev.stickers || [];
    this.overlays = prev.overlays || [];
    this.selectedItem = null;
    this.updateNearToolbar();
    this.updateUndoButtonState();
    this.emitSave();
    this.render();
  }

  updateUndoButtonState() {
    const btn = this.rootEl?.querySelector(".mc-undo-btn");
    if (!btn) return;
    btn.disabled = this.undoStack.length === 0;
    btn.style.opacity = this.undoStack.length === 0 ? "0.4" : "1";
  }

  setMode(newMode) {
    this.mode = newMode;
    this.rootEl.querySelectorAll(".mc-tool-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === newMode);
    });
    if (typeof this.navOpts.onModeSync === "function") {
      this.navOpts.onModeSync(newMode);
    }
    if (newMode === "STAMP") {
      this.renderStampPanelUI();
      this.stampPanel.classList.remove("hidden");
    } else {
      this.stampPanel.classList.add("hidden");
    }
    if (newMode !== "SELECT" && newMode !== "VIEW") {
      this.selectedItem = null;
      this.updateNearToolbar();
    }
    this.render();
  }

  setActiveColor(col) {
    this.activeColor = col;
    if (this.selectedItem) {
      const obj = this.getSelectedObject();
      if (obj && this.selectedItem.type !== "overlay") {
        this.pushUndoSnapshot();
        obj.color = col;
        if (this.selectedItem.type === "sticker") {
          obj.bg = col === "#FFFFFF" ? "#0F172A" : col;
          obj.color = "#FFFFFF";
        }
        this.emitSave();
        this.render();
      }
    }
  }

  setStrokeWidth(val) {
    this.strokeWidth = val;
    if (this.selectedItem) {
      const obj = this.getSelectedObject();
      if (obj && (this.selectedItem.type === "path" || this.selectedItem.type === "line" || this.selectedItem.type === "arrow")) {
        obj.strokeWidth = val;
        this.render();
      }
    }
  }

  resetZoom() {
    this.fitImageToScreen();
    this.updateNearToolbar();
    this.render();
  }

  buildDOM() {
    const quickColors = this.colors.slice(0, 6);
    this.container.innerHTML = `
      <div class="mc-root" style="position:relative; width:100%; height:100%; background:#F8FAFC; overflow:hidden; user-select:none; touch-action:none;">
        <canvas class="mc-canvas" style="display:block; width:100%; height:100%; background:#F8FAFC;"></canvas>

        <!-- 第二層精簡主工具列：左邊 A 組（拉尺/畫筆/文字/印章/貼圖）｜ 右邊 B 組（檢視/選取/復原/擦除） -->
        <div class="mc-topbar" style="position:absolute; top:8px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:4px; padding:4px 8px; background:rgba(255,255,255,0.96); border:1px solid #CBD5E1; border-radius:999px; box-shadow:0 4px 14px rgba(15,23,42,0.1); z-index:20; max-width:96vw; overflow-x:auto;">
          <button class="mc-tool-btn" data-mode="RULER" title="拉尺寸線">📏 拉尺</button>
          <button class="mc-tool-btn" data-mode="PEN" title="自由手繪">✏️ 畫筆</button>
          <button class="mc-tool-btn" data-mode="TEXT" title="普通純打字">🔤 文字</button>
          <button class="mc-tool-btn" data-mode="STAMP" title="現場常用印章">🏷️ 印章</button>
          <button type="button" class="mc-overlay-pick-btn" title="插入局部細節貼圖並可合併" style="background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap;">🖼️ 貼圖</button>

          <span style="color:#CBD5E1; font-weight:300;">|</span>

          <button class="mc-tool-btn active" data-mode="VIEW" title="安全檢視模式：單指拖動、雙指縮放不誤觸">👁️ 檢視</button>
          <button class="mc-tool-btn" data-mode="SELECT" title="選取並移動已畫好的標註或貼圖">✋ 選取</button>
          <button class="mc-undo-btn" title="復原上一步" disabled style="background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 7px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap; opacity:0.4;">↩ 復原</button>
          <button class="mc-tool-btn" data-mode="ERASER" title="點擊擦除單項">🧽 擦除</button>
        </div>

        <input type="file" class="mc-overlay-file-input hidden" accept="image/*" />

        <!-- 🏷️ 現場常用詞印章面板 -->
        <div class="mc-stamp-panel hidden" style="position:absolute; top:46px; left:50%; transform:translateX(-50%); width:min(440px, 94vw); background:rgba(255,255,255,0.92); backdrop-filter:blur(6px); border:1.5px solid #94A3B8; border-radius:10px; padding:7px 9px; box-shadow:0 8px 22px rgba(15,23,42,0.16); z-index:24; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
            <div class="mc-stamp-cats" style="display:flex; gap:4px; flex-wrap:wrap;"></div>
            <button type="button" class="mc-stamp-manage-btn" style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:5px; padding:2px 7px; font-size:11px; font-weight:700; color:#1D4ED8; cursor:pointer; white-space:nowrap;">⚙️ 管理雲端詞庫</button>
          </div>
          <div class="mc-stamp-items" style="display:flex; flex-wrap:wrap; gap:5px;"></div>
        </div>

        <!-- 選中物件的小工具條（拉遠距離不遮擋 + < > 微調按鈕 + 快捷色點 + 合併貼圖 + 純圖示 ✏️ 🗑️） -->
        <div class="mc-near-toolbar hidden" style="position:absolute; display:flex; align-items:center; gap:5px; padding:5px 9px; background:rgba(15,23,42,0.94); color:#FFF; border-radius:999px; box-shadow:0 6px 18px rgba(0,0,0,0.28); z-index:35; white-space:nowrap;">
          <button type="button" class="mc-near-dec" title="縮小 / 變幼" style="background:#334155; color:#FFF; border:none; border-radius:999px; width:22px; height:22px; font-size:13px; font-weight:800; cursor:pointer; line-height:1;">‹</button>
          <span class="mc-near-val" style="font-size:11px; font-weight:700; min-width:24px; text-align:center; color:#E2E8F0;">18</span>
          <button type="button" class="mc-near-inc" title="放大 / 變粗" style="background:#334155; color:#FFF; border:none; border-radius:999px; width:22px; height:22px; font-size:13px; font-weight:800; cursor:pointer; line-height:1;">›</button>

          <div class="mc-near-colors-wrap" style="display:flex; align-items:center; gap:3px; padding-left:4px; border-left:1px solid #475569;">
            ${quickColors.map(c => `
              <button type="button" class="mc-near-color" data-ncol="${c}"
                      style="width:14px; height:14px; border-radius:50%; background-color:${c}; border:1.5px solid #94A3B8; cursor:pointer; padding:0;"></button>
            `).join("")}
          </div>

          <button type="button" class="mc-near-merge hidden" title="合併貼圖進底圖" style="background:#059669; color:#FFF; border:none; border-radius:999px; padding:3px 9px; font-size:11px; font-weight:800; cursor:pointer;">📌 合併貼圖</button>
          <button type="button" class="mc-near-edit" title="改字" style="background:#334155; color:#FFF; border:none; border-radius:999px; width:24px; height:24px; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">✏️</button>
          <button type="button" class="mc-near-del" title="刪除" style="background:#EF4444; color:#FFF; border:none; border-radius:999px; width:24px; height:24px; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">🗑️</button>
        </div>

        <!-- 🔤 普通純打字極簡小框 -->
        <div class="mc-plain-text-box hidden" style="position:absolute; width:min(220px, 84vw); background:#FFF; border:1.5px solid #0F172A; border-radius:8px; padding:6px; box-shadow:0 8px 20px rgba(15,23,42,0.2); z-index:46; display:flex; flex-direction:column; gap:5px;">
          <input type="text" class="mc-plain-input" placeholder="輸入文字或數字..."
                 style="width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:13px;" />
          <div style="display:flex; justify-content:flex-end; gap:5px;">
            <button type="button" class="mc-plain-cancel" style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer;">取消</button>
            <button type="button" class="mc-plain-ok" style="background:#0F172A; color:#FFF; border:none; border-radius:4px; padding:2px 9px; font-size:11px; font-weight:700; cursor:pointer;">確定</button>
          </div>
        </div>

        <!-- ↗ 箭頭批改瘦身小浮窗 -->
        <div class="mc-arrow-box hidden" style="position:absolute; width:min(275px, 88vw); background:#FFF; border:1.5px solid #2563EB; border-radius:9px; padding:6px; box-shadow:0 10px 24px rgba(15,23,42,0.22); z-index:45; display:flex; flex-direction:column; gap:5px;">
          <div class="mc-arrow-status-row" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:3px;">
            ${ARROW_STATUS_BUTTONS.map(sb => `
              <button type="button" class="mc-st-pill" data-stkey="${sb.key}"
                      style="background:${sb.bg}; color:${sb.fg}; border:1.5px solid ${sb.border}; border-radius:5px; padding:3px 2px; font-size:10px; font-weight:800; cursor:pointer; text-align:center; white-space:nowrap;">
                ${sb.label}
              </button>
            `).join("")}
          </div>

          <div style="display:flex; gap:4px;">
            <input type="text" class="mc-arrow-input" placeholder="輸入批改字句或點下方雲端短語..."
                   style="flex:1; min-width:0; padding:4px 6px; border:1px solid #93C5FD; border-radius:5px; font-size:12px;" />
            <button type="button" class="mc-manage-phrase-btn" title="管理雲端短語庫" style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:700; color:#1D4ED8; cursor:pointer;">⚙️</button>
          </div>

          <div style="display:flex; gap:3px; overflow-x:auto;" class="mc-phrase-cats"></div>
          <div style="max-height:76px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; background:#F8FAFC; padding:3px; border-radius:4px; border:1px solid #E2E8F0;" class="mc-phrase-items"></div>

          <div style="display:flex; justify-content:flex-end; gap:5px;">
            <button type="button" class="mc-arrow-cancel" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer;">取消</button>
            <button type="button" class="mc-arrow-ok" style="background:#2563EB; color:#FFF; border:none; border-radius:4px; padding:2px 10px; font-size:11px; font-weight:800; cursor:pointer;">貼上批改</button>
          </div>
        </div>

        ${this.navOpts.hasPrev ? `<button class="mc-nav-prev" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); background:rgba(255,255,255,0.92); border:1px solid #CBD5E1; border-radius:999px; width:34px; height:34px; font-size:16px; font-weight:800; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.12); z-index:18;">‹</button>` : ""}
        ${this.navOpts.hasNext ? `<button class="mc-nav-next" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:rgba(255,255,255,0.92); border:1px solid #CBD5E1; border-radius:999px; width:34px; height:34px; font-size:16px; font-weight:800; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.12); z-index:18;">›</button>` : ""}
      </div>
    `;

    this.rootEl = this.container.querySelector(".mc-root");
    this.canvas = this.container.querySelector(".mc-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.nearToolbar = this.container.querySelector(".mc-near-toolbar");
    this.plainTextBox = this.container.querySelector(".mc-plain-text-box");
    this.plainInput = this.container.querySelector(".mc-plain-input");
    this.arrowBox = this.container.querySelector(".mc-arrow-box");
    this.arrowInput = this.container.querySelector(".mc-arrow-input");
    this.stampPanel = this.container.querySelector(".mc-stamp-panel");

    const styleTag = document.createElement("style");
    styleTag.textContent = `
      .mc-tool-btn { background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap; }
      .mc-tool-btn.active { background:#EFF6FF; border-color:#3B82F6; color:#1D4ED8; }
      .mc-st-pill.active { outline: 2px solid #0F172A; }
    `;
    this.rootEl.appendChild(styleTag);

    this.renderStampPanelUI();
    this.resizeCanvas();
  }

  renderStampPanelUI() {
    const groups = this.getStampGroups();
    const catsEl = this.stampPanel.querySelector(".mc-stamp-cats");
    const itemsEl = this.stampPanel.querySelector(".mc-stamp-items");
    if (!catsEl || !itemsEl) return;

    if (!groups.length) {
      catsEl.innerHTML = `<span style="font-size:11px; color:#64748B;">雲端尚未建立印章詞庫</span>`;
      itemsEl.innerHTML = `<div style="font-size:11px; color:#475569;">請點擊右上角「⚙️ 管理雲端詞庫」新增或一鍵匯入範本到雲端資料庫。</div>`;
      return;
    }

    if (this.activeStampCatIdx >= groups.length) this.activeStampCatIdx = 0;

    catsEl.innerHTML = groups.map((g, idx) => `
      <button type="button" class="mc-scat-btn" data-scidx="${idx}"
              style="padding:2px 8px; font-size:11px; border-radius:999px; border:1px solid ${idx === this.activeStampCatIdx ? "#0F172A" : "#CBD5E1"}; background:${idx === this.activeStampCatIdx ? "#0F172A" : "rgba(248,250,252,0.9)"}; color:${idx === this.activeStampCatIdx ? "#FFF" : "#334155"}; font-weight:700; cursor:pointer;">
        ${g.name}
      </button>
    `).join("");

    catsEl.querySelectorAll(".mc-scat-btn").forEach(b => {
      b.onclick = () => {
        this.activeStampCatIdx = Number(b.dataset.scidx);
        const firstItem = groups[this.activeStampCatIdx]?.items?.[0];
        if (firstItem) this.selectedStampLabel = firstItem;
        this.renderStampPanelUI();
      };
    });

    const curItems = groups[this.activeStampCatIdx]?.items || [];
    if (!curItems.includes(this.selectedStampLabel) && curItems.length) {
      this.selectedStampLabel = curItems[0];
    }

    itemsEl.innerHTML = curItems.map(lbl => `
      <button type="button" class="mc-sitem-btn" data-slbl="${lbl}"
              style="padding:3px 8px; font-size:12px; border-radius:5px; border:${lbl === this.selectedStampLabel ? "2px solid #DC2626" : "1px solid #CBD5E1"}; background:${lbl === this.selectedStampLabel ? "rgba(254,242,242,0.92)" : "rgba(255,255,255,0.9)"}; color:${lbl === this.selectedStampLabel ? "#991B1B" : "#1E293B"}; font-weight:700; cursor:pointer;">
        ${lbl}
      </button>
    `).join("") || `<div style="font-size:11px; color:#94A3B8;">此分類尚無詞彙</div>`;

    itemsEl.querySelectorAll(".mc-sitem-btn").forEach(b => {
      b.onclick = () => {
        this.selectedStampLabel = b.dataset.slbl;
        this.renderStampPanelUI();
      };
    });
  }

  resizeCanvas() {
    if (!this.canvas || !this.rootEl) return;
    const rect = this.rootEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.render();
  }

  fitImageToScreen() {
    if (!this.bgImg || !this.bgImg.naturalWidth || !this.viewW || !this.viewH) return;
    const iw = this.bgImg.naturalWidth;
    const ih = this.bgImg.naturalHeight;
    const padTop = 44;
    const availH = Math.max(100, this.viewH - padTop);
    const s = Math.min(this.viewW / iw, availH / ih);
    this.scale = s;
    this.offsetX = (this.viewW - iw * s) / 2;
    this.offsetY = padTop + (availH - ih * s) / 2;
  }

  screenToImg(sx, sy) {
    return { x: (sx - this.offsetX) / this.scale, y: (sy - this.offsetY) / this.scale };
  }

  imgToScreen(ix, iy) {
    return { x: ix * this.scale + this.offsetX, y: iy * this.scale + this.offsetY };
  }

  toggleWhiteBackground() {
    this.whiteBg = !this.whiteBg;
    this.render();
    return this.whiteBg;
  }

  bindEvents() {
    this._onResize = () => this.resizeCanvas();
    window.addEventListener("resize", this._onResize);

    this.rootEl.querySelectorAll(".mc-tool-btn").forEach(btn => {
      btn.onclick = () => this.setMode(btn.dataset.mode);
    });

    this.rootEl.querySelector(".mc-undo-btn").onclick = () => this.undo();

    // 🖼️ 貼圖選擇與壓縮匯入
    const overlayInput = this.rootEl.querySelector(".mc-overlay-file-input");
    this.rootEl.querySelector(".mc-overlay-pick-btn").onclick = () => overlayInput.click();
    overlayInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const rawImg = new Image();
        rawImg.onload = () => {
          const maxSide = 900;
          const sc = Math.min(1, maxSide / Math.max(rawImg.width, rawImg.height));
          const c = document.createElement("canvas");
          c.width = Math.round(rawImg.width * sc);
          c.height = Math.round(rawImg.height * sc);
          c.getContext("2d").drawImage(rawImg, 0, 0, c.width, c.height);
          this.addPhotoOverlay(c.toDataURL("image/jpeg", 0.82));
        };
        rawImg.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      overlayInput.value = "";
    };

    this.stampPanel.querySelector(".mc-stamp-manage-btn").onclick = () => {
      if (typeof this.navOpts.onOpenDictManager === "function") {
        this.navOpts.onOpenDictManager("STAMP", () => this.renderStampPanelUI());
      }
    };

    const prevBtn = this.rootEl.querySelector(".mc-nav-prev");
    if (prevBtn && this.navOpts.onPrev) prevBtn.onclick = () => this.navOpts.onPrev();
    const nextBtn = this.rootEl.querySelector(".mc-nav-next");
    if (nextBtn && this.navOpts.onNext) nextBtn.onclick = () => this.navOpts.onNext();

    const adjustSelectedSize = (delta) => {
      const obj = this.getSelectedObject();
      if (!obj) return;
      this.pushUndoSnapshot();
      if (this.selectedItem.type === "overlay") {
        const factor = delta > 0 ? 1.15 : 0.87;
        obj.w = Math.max(40, obj.w * factor);
        obj.h = Math.max(40, obj.h * factor);
      } else if (this.selectedItem.type === "marker" || this.selectedItem.type === "sticker" || this.selectedItem.type === "arrow") {
        const next = Math.min(60, Math.max(10, (obj.fontSize || 18) + delta));
        obj.fontSize = next;
        this.fontSize = next;
      } else {
        const next = Math.min(10, Math.max(0.5, Number(((obj.strokeWidth || 1.5) + (delta > 0 ? 0.5 : -0.5)).toFixed(1))));
        obj.strokeWidth = next;
      }
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };

    this.nearToolbar.querySelector(".mc-near-dec").onclick = () => adjustSelectedSize(-2);
    this.nearToolbar.querySelector(".mc-near-inc").onclick = () => adjustSelectedSize(2);

    this.nearToolbar.querySelector(".mc-near-merge").onclick = async () => {
      if (this.selectedItem?.type !== "overlay") return;
      await this.flattenOverlaysIntoBase(this.selectedItem.index);
    };

    this.nearToolbar.querySelectorAll(".mc-near-color").forEach(btn => {
      btn.onclick = () => {
        const obj = this.getSelectedObject();
        if (!obj || this.selectedItem.type === "overlay") return;
        this.pushUndoSnapshot();
        const col = btn.dataset.ncol;
        if (this.selectedItem.type === "sticker") {
          obj.bg = col === "#FFFFFF" ? "#0F172A" : col;
          obj.color = "#FFFFFF";
        } else {
          obj.color = col;
        }
        this.emitSave();
        this.render();
      };
    });

    this.nearToolbar.querySelector(".mc-near-edit").onclick = () => {
      const obj = this.getSelectedObject();
      if (!obj) return;
      const anchor = this.getObjectAnchorImg(this.selectedItem.type, obj);
      const scr = this.imgToScreen(anchor.x, anchor.y);
      if (this.selectedItem.type === "arrow") {
        this.openArrowEditor(scr.x, scr.y, obj.text || "", obj.status || "NEED_FIX", (newTxt, newStatus) => {
          this.pushUndoSnapshot();
          obj.text = newTxt;
          obj.status = newStatus;
          this.emitSave(newTxt ? `[${this.formatStatusLabel(newStatus)}] ${newTxt}` : "", newStatus);
          this.render();
        });
      } else {
        this.openPlainTextEditor(scr.x, scr.y, obj.text || obj.label || "", (newTxt) => {
          this.pushUndoSnapshot();
          if (this.selectedItem.type === "sticker") obj.label = newTxt;
          else obj.text = newTxt;
          this.emitSave();
          this.render();
        });
      }
    };

    this.nearToolbar.querySelector(".mc-near-del").onclick = () => {
      if (!this.selectedItem) return;
      this.pushUndoSnapshot();
      this.deleteObjectAt(this.selectedItem.type, this.selectedItem.index);
      this.selectedItem = null;
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };

    this.plainTextBox.querySelector(".mc-plain-cancel").onclick = () => {
      this.plainTextBox.classList.add("hidden");
      this.pendingPlainTextAction = null;
    };
    this.plainTextBox.querySelector(".mc-plain-ok").onclick = () => this.commitPlainText(true);
    this.plainInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitPlainText(true); }
    });

    this.arrowBox.querySelectorAll(".mc-st-pill").forEach(pill => {
      pill.onclick = () => {
        this.selectedArrowStatus = pill.dataset.stkey;
        this.updateArrowStatusPills();
        this.arrowInput.focus();
      };
    });
    this.arrowBox.querySelector(".mc-arrow-cancel").onclick = () => {
      this.arrowBox.classList.add("hidden");
      this.pendingArrowAction = null;
    };
    this.arrowBox.querySelector(".mc-arrow-ok").onclick = () => this.commitArrowEditor(true);
    this.arrowInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitArrowEditor(true); }
    });
    this.arrowBox.querySelector(".mc-manage-phrase-btn").onclick = () => {
      if (typeof this.navOpts.onOpenDictManager === "function") {
        this.navOpts.onOpenDictManager("PHRASE", () => this.renderArrowPhraseUI());
      }
    };

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });

    this.canvas.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.handlePointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.handlePointerUp(e));

    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        this.isDrawing = false;
        this.draftObj = null;
        this.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && this.pinchDist > 0) {
        const newDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const rect = this.canvas.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        this.zoomAt(cx, cy, newDist / this.pinchDist);
        this.pinchDist = newDist;
      }
    }, { passive: true });
  }

  zoomAt(sx, sy, factor) {
    const newScale = Math.min(8, Math.max(0.2, this.scale * factor));
    const ratio = newScale / this.scale;
    this.offsetX = sx - (sx - this.offsetX) * ratio;
    this.offsetY = sy - (sy - this.offsetY) * ratio;
    this.scale = newScale;
    this.updateNearToolbar();
    this.render();
  }

  handlePointerDown(e) {
    if (e.pointerType === "touch" && !e.isPrimary) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pt = this.screenToImg(sx, sy);

    const now = Date.now();
    if (now - this.lastTapTime < 320 && this.lastTapPos && Math.hypot(sx - this.lastTapPos.x, sy - this.lastTapPos.y) < 22) {
      const hit = this.hitTest(pt.x, pt.y);
      if (hit && (hit.type === "marker" || hit.type === "arrow" || hit.type === "line" || hit.type === "sticker")) {
        this.selectedItem = hit;
        this.updateNearToolbar();
        const obj = this.getSelectedObject();
        if (hit.type === "arrow") {
          this.openArrowEditor(sx, sy, obj.text || "", obj.status || "NEED_FIX", (newTxt, newStatus) => {
            this.pushUndoSnapshot();
            obj.text = newTxt;
            obj.status = newStatus;
            this.emitSave(newTxt ? `[${this.formatStatusLabel(newStatus)}] ${newTxt}` : "", newStatus);
            this.render();
          });
        } else {
          this.openPlainTextEditor(sx, sy, obj.text || obj.label || "", (newTxt) => {
            this.pushUndoSnapshot();
            if (hit.type === "sticker") obj.label = newTxt;
            else obj.text = newTxt;
            this.emitSave();
            this.render();
          });
        }
        this.lastTapTime = 0;
        return;
      }
    }
    this.lastTapTime = now;
    this.lastTapPos = { x: sx, y: sy };

    if (this.mode === "VIEW") {
      if (this.selectedItem) {
        this.selectedItem = null;
        this.updateNearToolbar();
        this.render();
      }
      this.isPanning = true;
      this.panStart = { x: sx - this.offsetX, y: sy - this.offsetY };
      return;
    }

    if (this.mode === "ERASER") {
      const hit = this.hitTest(pt.x, pt.y);
      if (hit) {
        this.pushUndoSnapshot();
        this.deleteObjectAt(hit.type, hit.index);
        this.selectedItem = null;
        this.updateNearToolbar();
        this.emitSave();
        this.render();
      }
      return;
    }

    if (this.mode === "SELECT") {
      const hit = this.hitTest(pt.x, pt.y);
      if (hit) {
        this.selectedItem = hit;
        this.dragTarget = {
          ...hit,
          startImg: pt,
          moved: false,
          orig: JSON.parse(JSON.stringify(this.getSelectedObject()))
        };
        this.updateNearToolbar();
        this.render();
      } else {
        this.selectedItem = null;
        this.updateNearToolbar();
        this.isPanning = true;
        this.panStart = { x: sx - this.offsetX, y: sy - this.offsetY };
        this.render();
      }
      return;
    }

    if (this.mode === "TEXT") {
      this.openPlainTextEditor(sx, sy, "", (txt) => {
        if (!txt.trim()) {
          this.setMode("VIEW");
          return;
        }
        this.pushUndoSnapshot();
        this.markers.push({
          x: pt.x, y: pt.y,
          text: txt.trim(),
          color: this.activeColor,
          fontSize: this.fontSize
        });
        this.selectedItem = { type: "marker", index: this.markers.length - 1 };
        this.setMode("VIEW");
        this.updateNearToolbar();
        this.emitSave();
        this.render();
      });
      return;
    }

    if (this.mode === "STAMP") {
      if (!this.selectedStampLabel) {
        if (typeof this.navOpts.onOpenDictManager === "function") {
          this.navOpts.onOpenDictManager("STAMP", () => this.renderStampPanelUI());
        }
        return;
      }
      this.pushUndoSnapshot();
      this.stickers.push({
        x: pt.x, y: pt.y,
        label: this.selectedStampLabel,
        bg: this.activeColor === "#FFFFFF" ? "#0F172A" : this.activeColor,
        color: "#FFFFFF",
        fontSize: 15
      });
      this.selectedItem = { type: "sticker", index: this.stickers.length - 1 };
      this.setMode("VIEW");
      this.updateNearToolbar();
      this.emitSave();
      this.render();
      return;
    }

    if (this.mode === "ARROW") {
      this.isDrawing = true;
      this.draftObj = {
        type: "arrow",
        x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
        color: this.activeColor,
        strokeWidth: this.strokeWidth,
        fontSize: this.fontSize,
        text: "",
        status: "NEED_FIX"
      };
      return;
    }

    if (this.mode === "RULER") {
      this.isDrawing = true;
      this.draftObj = {
        type: "line",
        x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
        color: this.activeColor,
        strokeWidth: this.strokeWidth,
        text: ""
      };
      return;
    }

    if (this.mode === "PEN") {
      this.isDrawing = true;
      this.draftObj = {
        type: "path",
        points: [{ x: pt.x, y: pt.y }],
        color: this.activeColor,
        strokeWidth: this.strokeWidth
      };
    }
  }

  handlePointerMove(e) {
    if (e.pointerType === "touch" && !e.isPrimary) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.isPanning) {
      this.offsetX = sx - this.panStart.x;
      this.offsetY = sy - this.panStart.y;
      this.updateNearToolbar();
      this.render();
      return;
    }

    const pt = this.screenToImg(sx, sy);

    if (this.dragTarget) {
      const dx = pt.x - this.dragTarget.startImg.x;
      const dy = pt.y - this.dragTarget.startImg.y;
      if (!this.dragTarget.moved && Math.hypot(dx, dy) > 2 / this.scale) {
        this.pushUndoSnapshot();
        this.dragTarget.moved = true;
      }
      const obj = this.getSelectedObject();
      const orig = this.dragTarget.orig;
      if (obj && orig) {
        if (this.dragTarget.type === "marker" || this.dragTarget.type === "sticker" || this.dragTarget.type === "overlay") {
          obj.x = orig.x + dx; obj.y = orig.y + dy;
        } else if (this.dragTarget.type === "line" || this.dragTarget.type === "arrow") {
          obj.x1 = orig.x1 + dx; obj.y1 = orig.y1 + dy;
          obj.x2 = orig.x2 + dx; obj.y2 = orig.y2 + dy;
        } else if (this.dragTarget.type === "path" && Array.isArray(orig.points)) {
          obj.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        }
        this.updateNearToolbar();
        this.render();
      }
      return;
    }

    if (this.isDrawing && this.draftObj) {
      if (this.draftObj.type === "arrow" || this.draftObj.type === "line") {
        this.draftObj.x2 = pt.x; this.draftObj.y2 = pt.y;
      } else if (this.draftObj.type === "path") {
        this.draftObj.points.push({ x: pt.x, y: pt.y });
      }
      this.render();
    }
  }

  handlePointerUp(e) {
    if (this.isPanning) { this.isPanning = false; return; }
    if (this.dragTarget) {
      const didMove = this.dragTarget.moved;
      this.dragTarget = null;
      if (didMove) this.emitSave();
      return;
    }
    if (!this.isDrawing || !this.draftObj) return;
    this.isDrawing = false;
    const finished = this.draftObj;
    this.draftObj = null;

    if (finished.type === "arrow") {
      if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) < 10) {
        this.render();
        return;
      }
      this.pushUndoSnapshot();
      this.arrows.push(finished);
      this.selectedItem = { type: "arrow", index: this.arrows.length - 1 };
      this.render();

      const tailScr = this.imgToScreen(finished.x2, finished.y2);
      this.openArrowEditor(tailScr.x, tailScr.y, "", "NEED_FIX", (txt, status) => {
        const finalLabel = txt.trim() || this.formatStatusLabel(status);
        finished.text = finalLabel;
        finished.status = status;
        this.setMode("VIEW");
        this.updateNearToolbar();
        this.emitSave(finalLabel, status);
        this.render();
      });
      return;
    }

    if (finished.type === "line") {
      if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) < 10) {
        this.render();
        return;
      }
      this.pushUndoSnapshot();
      this.lines.push(finished);
      this.selectedItem = { type: "line", index: this.lines.length - 1 };
      this.render();

      const midScr = this.imgToScreen((finished.x1 + finished.x2) / 2, (finished.y1 + finished.y2) / 2);
      this.openPlainTextEditor(midScr.x, midScr.y, "", (txt) => {
        finished.text = txt.trim();
        this.updateNearToolbar();
        this.emitSave();
        this.render();
      });
      return;
    }

    if (finished.type === "path" && finished.points.length > 1) {
      this.pushUndoSnapshot();
      this.paths.push(finished);
      this.selectedItem = { type: "path", index: this.paths.length - 1 };
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    }
  }

  formatStatusLabel(st) {
    if (st === "OK") return "✅ 確認無誤";
    if (st === "SITE_CHECK") return "⚠️ 現場核對";
    if (st === "NEED_INFO") return "📌 待補資料";
    return "❌ 需修改";
  }

  openPlainTextEditor(screenX, screenY, initialText, onConfirm) {
    this.arrowBox.classList.add("hidden");
    this.pendingPlainTextAction = onConfirm;
    this.plainInput.value = initialText || "";
    this.plainTextBox.classList.remove("hidden");
    const boxW = Math.min(220, this.viewW * 0.84);
    const left = Math.max(10, Math.min(this.viewW - boxW - 10, screenX - boxW / 2));
    const top = screenY + 75 > this.viewH ? Math.max(48, screenY - 75) : Math.max(48, screenY + 12);
    this.plainTextBox.style.left = `${left}px`;
    this.plainTextBox.style.top = `${top}px`;
    setTimeout(() => { this.plainInput.focus(); this.plainInput.select(); }, 25);
  }

  commitPlainText(shouldSave = true) {
    if (!this.pendingPlainTextAction) return;
    const val = this.plainInput.value;
    const fn = this.pendingPlainTextAction;
    this.pendingPlainTextAction = null;
    this.plainTextBox.classList.add("hidden");
    if (shouldSave) fn(val);
  }

  openArrowEditor(screenX, screenY, initialText, initialStatus, onConfirm) {
    this.plainTextBox.classList.add("hidden");
    this.pendingArrowAction = onConfirm;
    this.arrowInput.value = initialText || "";
    this.selectedArrowStatus = initialStatus || "NEED_FIX";
    this.updateArrowStatusPills();

    this.arrowBox.classList.remove("hidden");
    const boxW = Math.min(275, this.viewW * 0.88);
    const boxH = 185;
    const left = Math.max(10, Math.min(this.viewW - boxW - 10, screenX - boxW / 2));
    const top = screenY + 16 + boxH > this.viewH ? Math.max(48, screenY - boxH - 12) : Math.max(48, screenY + 12);

    this.arrowBox.style.left = `${left}px`;
    this.arrowBox.style.top = `${top}px`;
    this.renderArrowPhraseUI();
    setTimeout(() => { this.arrowInput.focus(); }, 25);
  }

  updateArrowStatusPills() {
    this.arrowBox.querySelectorAll(".mc-st-pill").forEach(p => {
      if (p.dataset.stkey === this.selectedArrowStatus) p.classList.add("active");
      else p.classList.remove("active");
    });
  }

  renderArrowPhraseUI() {
    const phrases = this.getPhraseBank();
    const catsEl = this.arrowBox.querySelector(".mc-phrase-cats");
    const itemsEl = this.arrowBox.querySelector(".mc-phrase-items");
    if (!catsEl || !itemsEl) return;

    if (!phrases.length) {
      catsEl.innerHTML = "";
      itemsEl.innerHTML = `<div style="font-size:10px; color:#64748B; padding:3px;">雲端尚未建立短語，點右上「⚙️」新增或匯入範本。</div>`;
      return;
    }

    const cats = ["全部", ...new Set(phrases.map(p => p.cat || "常用"))];
    catsEl.innerHTML = cats.map(c => `
      <button type="button" class="mc-pcat-btn" data-pcat="${c}"
              style="padding:1px 5px; font-size:10px; border-radius:4px; border:1px solid ${this.activePhraseCat === c ? "#2563EB" : "#CBD5E1"}; background:${this.activePhraseCat === c ? "#DBEAFE" : "#FFF"}; color:${this.activePhraseCat === c ? "#1D4ED8" : "#475569"}; font-weight:700; cursor:pointer; white-space:nowrap;">
        ${c}
      </button>
    `).join("");

    catsEl.querySelectorAll(".mc-pcat-btn").forEach(b => {
      b.onclick = () => { this.activePhraseCat = b.dataset.pcat; this.renderArrowPhraseUI(); };
    });

    const filtered = this.activePhraseCat === "全部"
      ? phrases
      : phrases.filter(p => (p.cat || "常用") === this.activePhraseCat);

    itemsEl.innerHTML = filtered.map(p => `
      <button type="button" class="mc-pitem-btn" data-ptext="${p.text.replace(/"/g, "&quot;")}"
              style="text-align:left; background:#FFF; border:1px solid #E2E8F0; border-radius:3px; padding:2px 5px; font-size:10px; color:#1E293B; cursor:pointer;">
        ${p.text}
      </button>
    `).join("");

    itemsEl.querySelectorAll(".mc-pitem-btn").forEach(b => {
      b.onclick = () => {
        const txt = b.dataset.ptext;
        this.arrowInput.value = this.arrowInput.value ? `${this.arrowInput.value} ${txt}` : txt;
        this.arrowInput.focus();
      };
    });
  }

  commitArrowEditor(shouldSave = true) {
    if (!this.pendingArrowAction) return;
    const val = this.arrowInput.value;
    const st = this.selectedArrowStatus || "NEED_FIX";
    const fn = this.pendingArrowAction;
    this.pendingArrowAction = null;
    this.arrowBox.classList.add("hidden");
    if (shouldSave) fn(val, st);
  }

  commitInline(shouldSave = false) {
    this.commitPlainText(shouldSave);
    this.commitArrowEditor(shouldSave);
  }

  getSelectedObject() {
    if (!this.selectedItem) return null;
    const { type, index } = this.selectedItem;
    if (type === "line") return this.lines[index];
    if (type === "marker") return this.markers[index];
    if (type === "path") return this.paths[index];
    if (type === "arrow") return this.arrows[index];
    if (type === "sticker") return this.stickers[index];
    if (type === "overlay") return this.overlays[index];
    return null;
  }

  getObjectAnchorImg(type, obj) {
    if (type === "marker" || type === "sticker") return { x: obj.x, y: obj.y };
    if (type === "overlay") return { x: obj.x, y: obj.y + obj.h / 2 };
    if (type === "arrow") return { x: obj.x2, y: obj.y2 };
    if (type === "line") return { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
    if (type === "path" && obj.points?.length) {
      const mid = obj.points[Math.floor(obj.points.length / 2)];
      return { x: mid.x, y: mid.y };
    }
    return { x: 0, y: 0 };
  }

  updateNearToolbar() {
    const obj = this.getSelectedObject();
    if (!obj) {
      this.nearToolbar.classList.add("hidden");
      return;
    }
    const anchor = this.getObjectAnchorImg(this.selectedItem.type, obj);
    const scr = this.imgToScreen(anchor.x, anchor.y);

    const valEl = this.nearToolbar.querySelector(".mc-near-val");
    const editBtn = this.nearToolbar.querySelector(".mc-near-edit");
    const mergeBtn = this.nearToolbar.querySelector(".mc-near-merge");
    const colorsWrap = this.nearToolbar.querySelector(".mc-near-colors-wrap");

    if (this.selectedItem.type === "overlay") {
      valEl.textContent = `${Math.round(obj.w)}w`;
      editBtn.style.display = "none";
      colorsWrap.style.display = "none";
      mergeBtn.classList.remove("hidden");
    } else {
      mergeBtn.classList.add("hidden");
      colorsWrap.style.display = "flex";
      if (this.selectedItem.type === "marker" || this.selectedItem.type === "sticker" || this.selectedItem.type === "arrow") {
        valEl.textContent = String(obj.fontSize || 18);
        editBtn.style.display = "inline-flex";
      } else {
        valEl.textContent = String(obj.strokeWidth || 1.5);
        editBtn.style.display = this.selectedItem.type === "line" ? "inline-flex" : "none";
      }
    }

    this.nearToolbar.classList.remove("hidden");
    const barW = 260;
    const left = Math.max(8, Math.min(this.viewW - barW - 8, scr.x - barW / 2));
    const top = scr.y + 68 > this.viewH - 12 ? Math.max(46, scr.y - 68) : Math.max(46, scr.y + 34);
    this.nearToolbar.style.left = `${left}px`;
    this.nearToolbar.style.top = `${top}px`;
  }

  deleteObjectAt(type, idx) {
    if (type === "line") this.lines.splice(idx, 1);
    else if (type === "marker") this.markers.splice(idx, 1);
    else if (type === "path") this.paths.splice(idx, 1);
    else if (type === "arrow") this.arrows.splice(idx, 1);
    else if (type === "sticker") this.stickers.splice(idx, 1);
    else if (type === "overlay") this.overlays.splice(idx, 1);
  }

  getPillBoundsImg(ix, iy, text, fontPx = 15) {
    const fs = fontPx / this.scale;
    this.ctx.save();
    this.ctx.font = `800 ${fs}px sans-serif`;
    const lines = String(text || "").split("\n");
    const maxW = Math.max(...lines.map(l => this.ctx.measureText(l).width), 20 / this.scale);
    this.ctx.restore();
    const padX = 8 / this.scale;
    const padY = 5 / this.scale;
    const lineH = fs * 1.25;
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lineH + padY * 2;
    return { x: ix - boxW / 2, y: iy - boxH / 2, w: boxW, h: boxH };
  }

  getMarkerBoundsImg(m) {
    const fs = (m.fontSize || 18) / this.scale;
    this.ctx.save();
    this.ctx.font = `800 ${fs}px sans-serif`;
    const wText = Math.max(this.ctx.measureText(m.text || "").width, 20 / this.scale);
    this.ctx.restore();
    const padX = 6 / this.scale;
    const padY = 4 / this.scale;
    const w = wText + padX * 2;
    const h = fs + padY * 2;
    return { x: m.x - w / 2, y: m.y - h / 2, w, h };
  }

  hitTest(ix, iy) {
    const tol = 22 / this.scale;
    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i];
      const b = this.getPillBoundsImg(s.x, s.y, s.label, s.fontSize || 15);
      if (ix >= b.x - tol / 2 && ix <= b.x + b.w + tol / 2 && iy >= b.y - tol / 2 && iy <= b.y + b.h + tol / 2) {
        return { type: "sticker", index: i };
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      const b = this.getMarkerBoundsImg(m);
      if (ix >= b.x - tol / 2 && ix <= b.x + b.w + tol / 2 && iy >= b.y - tol / 2 && iy <= b.y + b.h + tol / 2) {
        return { type: "marker", index: i };
      }
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      if (this.distToSegment(ix, iy, a.x1, a.y1, a.x2, a.y2) < tol) return { type: "arrow", index: i };
      if (a.text) {
        const b = this.getPillBoundsImg(a.x2, a.y2, a.text, a.fontSize || 16);
        if (ix >= b.x - tol / 2 && ix <= b.x + b.w + tol / 2 && iy >= b.y - tol / 2 && iy <= b.y + b.h + tol / 2) {
          return { type: "arrow", index: i };
        }
      }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (this.distToSegment(ix, iy, l.x1, l.y1, l.x2, l.y2) < tol) return { type: "line", index: i };
    }
    for (let i = this.paths.length - 1; i >= 0; i--) {
      const p = this.paths[i];
      for (let j = 1; j < p.points.length; j++) {
        if (this.distToSegment(ix, iy, p.points[j - 1].x, p.points[j - 1].y, p.points[j].x, p.points[j].y) < tol) return { type: "path", index: i };
      }
    }
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const ov = this.overlays[i];
      if (ix >= ov.x - ov.w / 2 && ix <= ov.x + ov.w / 2 && iy >= ov.y - ov.h / 2 && iy <= ov.y + ov.h / 2) {
        return { type: "overlay", index: i };
      }
    }
    return null;
  }

  distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  emitSave(newReviewNote = "", newReviewStatus = "NEED_FIX") {
    if (typeof this.onChange === "function") {
      this.onChange({
        lines: this.lines,
        markers: this.markers,
        paths: this.paths,
        arrows: this.arrows,
        stickers: this.stickers,
        overlays: this.overlays,
        newReviewNote,
        newReviewStatus
      });
    }
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    if (this.whiteBg && this.bgImg.naturalWidth) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, this.bgImg.naturalWidth, this.bgImg.naturalHeight);
    } else if (this.bgImg && this.bgImg.complete && this.bgImg.naturalWidth) {
      ctx.drawImage(this.bgImg, 0, 0);
    }

    // 繪製貼圖圖層（未合併前可自由移動縮放）
    this.overlays.forEach((ov, idx) => {
      const im = this.getOverlayImageElement(ov.src);
      if (im && im.complete && im.naturalWidth) {
        ctx.save();
        ctx.drawImage(im, ov.x - ov.w / 2, ov.y - ov.h / 2, ov.w, ov.h);
        const isSel = this.selectedItem?.type === "overlay" && this.selectedItem.index === idx;
        ctx.strokeStyle = isSel ? "#FACC15" : "#64748B";
        ctx.lineWidth = (isSel ? 3 : 1.2) / this.scale;
        ctx.strokeRect(ov.x - ov.w / 2, ov.y - ov.h / 2, ov.w, ov.h);
        ctx.restore();
      }
    });

    const allPaths = this.draftObj?.type === "path" ? [...this.paths, this.draftObj] : this.paths;
    allPaths.forEach((p, idx) => {
      if (!p.points || p.points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = p.color || "#DC2626";
      ctx.lineWidth = (p.strokeWidth || 1.5) / this.scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(p.points[0].x, p.points[0].y);
      for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y);
      ctx.stroke();
      if (this.selectedItem?.type === "path" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = ((p.strokeWidth || 1.5) + 4) / this.scale;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
      }
      ctx.restore();
    });

    const allLines = this.draftObj?.type === "line" ? [...this.lines, this.draftObj] : this.lines;
    allLines.forEach((l, idx) => {
      ctx.save();
      const sw = (l.strokeWidth || 1.8) / this.scale;
      ctx.strokeStyle = l.color || "#2563EB";
      ctx.lineWidth = sw;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();

      const r = 4 / this.scale;
      ctx.fillStyle = l.color || "#2563EB";
      ctx.beginPath();
      ctx.arc(l.x1, l.y1, r, 0, Math.PI * 2);
      ctx.arc(l.x2, l.y2, r, 0, Math.PI * 2);
      ctx.fill();

      if (l.text) {
        const mx = (l.x1 + l.x2) / 2;
        const my = (l.y1 + l.y2) / 2;
        this.drawPillLabel(ctx, mx, my, l.text, "#FFFFFF", l.color || "#2563EB", 14, 0.88);
      }
      if (this.selectedItem?.type === "line" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = sw + 4 / this.scale;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
      }
      ctx.restore();
    });

    const allArrows = this.draftObj?.type === "arrow" ? [...this.arrows, this.draftObj] : this.arrows;
    allArrows.forEach((a, idx) => {
      ctx.save();
      const col = a.color || "#DC2626";
      const sw = (a.strokeWidth || 1.8) / this.scale;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = sw;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();

      const ang = Math.atan2(a.y1 - a.y2, a.x1 - a.x2);
      const headLen = 12 / this.scale;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x1 - headLen * Math.cos(ang - Math.PI / 6), a.y1 - headLen * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(a.x1 - headLen * Math.cos(ang + Math.PI / 6), a.y1 - headLen * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();

      const isSel = this.selectedItem?.type === "arrow" && this.selectedItem.index === idx;
      if (a.text) {
        this.drawPillLabel(ctx, a.x2, a.y2, a.text, col, "#FFFFFF", a.fontSize || 16, 0.78, isSel);
      }
      if (isSel) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = sw + 4 / this.scale;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
      }
      ctx.restore();
    });

    this.markers.forEach((m, idx) => {
      ctx.save();
      const b = this.getMarkerBoundsImg(m);
      const fs = (m.fontSize || 18) / this.scale;
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 4 / this.scale);
      ctx.fill();

      ctx.font = `800 ${fs}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = m.color || "#DC2626";
      ctx.fillText(m.text || "", m.x, m.y);

      if (this.selectedItem?.type === "marker" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = 2.5 / this.scale;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
      ctx.restore();
    });

    this.stickers.forEach((st, idx) => {
      ctx.save();
      const isSel = this.selectedItem?.type === "sticker" && this.selectedItem.index === idx;
      this.drawPillLabel(ctx, st.x, st.y, st.label || "", st.bg || "#DC2626", st.color || "#FFFFFF", st.fontSize || 15, 0.76, isSel);
      ctx.restore();
    });

    ctx.restore();
  }

  drawPillLabel(ctx, ix, iy, text, bg, fg, fontPx = 15, bgAlpha = 0.76, isSelected = false) {
    const b = this.getPillBoundsImg(ix, iy, text, fontPx);
    const fs = fontPx / this.scale;
    const padY = 5 / this.scale;
    const lineH = fs * 1.25;
    const lines = String(text || "").split("\n");

    ctx.save();
    ctx.globalAlpha = bgAlpha;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 6 / this.scale);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSelected ? "#FACC15" : bg;
    ctx.lineWidth = (isSelected ? 2.8 : 1.2) / this.scale;
    ctx.stroke();

    ctx.font = `800 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = fg;
    lines.forEach((ln, i) => {
      ctx.fillText(ln, ix, b.y + padY + lineH * (i + 0.5));
    });
    ctx.restore();
  }
}
