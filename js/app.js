const ARROW_STATUS_BUTTONS = [
  { key: "OK", label: "確認", bg: "#DCFCE7", fg: "#166534", border: "#86EFAC" },
  { key: "NEED_FIX", label: "需改", bg: "#FEE2E2", fg: "#991B1B", border: "#FCA5A5" },
  { key: "SITE_CHECK", label: "再核對", bg: "#FEF3C7", fg: "#92400E", border: "#FCD34D" },
  { key: "NEED_INFO", label: "待補資料", bg: "#DBEAFE", fg: "#1E40AF", border: "#93C5FD" }
];

const RULER_QUICK_WORDS = ["闊", "高", "深", "凹", "凸", "外計", "內計"];

const RULER_CATEGORY_ITEMS = {
  "高": ["樓底", "假天花底", "陣底", "石基", "最低陣底", "窗台面", "窗石高", "面高"],
  "留位": [
    "來水", "去水", "冷氣雪種", "冷氣去水", "明喉(闊高厚)", "地漏",
    "通道", "腳線(高厚)", "開門佔位", "門框(闊高厚)", "窗簾盒(闊高厚)", "門檻級差(闊高厚)",
    "煤氣錶(闊高厚)", "熱水爐(闊高厚)", "煙道孔(闊高厚)", "煮食爐", "洗碗機(闊高深)", "雪櫃(闊高深)", "洗衣機(闊高深)",
    "電箱(闊高厚)", "冷氣(闊高厚)", "對講機(闊高厚)", "消防頭(闊高)", "天花燈(闊高厚)"
  ],
  "構造": ["收口", "生側", "明線", "平線", "木殼", "牆身斜"]
};

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

    this.mode = "VIEW";
    this.multiSelectMode = false;
    this.activeColor = this.colors[0] || "#DC2626";
    this.strokeWidth = 1.5;
    this.fontSize = 18;
    this.whiteBg = false;
    this.selectedItems = [];
    this.undoStack = [];

    this.scale = 1;
    this.fitScale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.isDrawing = false;
    this.draftObj = null;
    this.dragGroupState = null;
    this.marqueeRect = null;
    this.lastTapTime = 0;
    this.lastTapPos = null;
    this.pinchDist = 0;

    this.activePhraseCat = "全部";
    this.activeRulerCat = "高";
    this.pendingArrowAction = null;
    this.pendingPlainTextAction = null;
    this.pendingRulerAction = null;
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

  isItemSelected(type, index) {
    return this.selectedItems.some(s => s.type === type && s.index === index);
  }

  setSingleSelection(item) {
    this.selectedItems = item ? [item] : [];
  }

  toggleSelectionItem(item) {
    if (!item) return;
    const idx = this.selectedItems.findIndex(s => s.type === item.type && s.index === item.index);
    if (idx >= 0) this.selectedItems.splice(idx, 1);
    else this.selectedItems.push(item);
  }

  isAnyEditorOpen() {
    const plainOpen = this.plainTextBox && !this.plainTextBox.classList.contains("hidden");
    const arrowOpen = this.arrowBox && !this.arrowBox.classList.contains("hidden");
    const rulerOpen = this.rulerBox && !this.rulerBox.classList.contains("hidden");
    return Boolean(plainOpen || arrowOpen || rulerOpen);
  }

  getAdaptiveFontSize(basePx = 18) {
    const zoomRatio = Math.max(0.8, this.scale / Math.max(0.05, this.fitScale || 1));
    return Math.min(72, Math.max(basePx, Math.round(basePx * zoomRatio)));
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
      this.overlays.push({ x: baseW * 0.5, y: baseH * 0.5, w: targetW, h: targetH, src: dataUrl });
      this.overlayImageCache.set(dataUrl, img);
      this.setSingleSelection({ type: "overlay", index: this.overlays.length - 1 });
      this.setMode("SELECT_SINGLE");
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };
    img.src = dataUrl;
  }

  async flattenSelectedItemsIntoBase() {
    if (!this.selectedItems.length) return;
    this.pushUndoSnapshot();

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

    const renderScale = Math.max(0.2, this.scale || 1);

    for (const targetItem of this.selectedItems) {
      const { type, index } = targetItem;
      const obj = this.getObjectByTypeAndIndex(type, index);
      if (!obj) continue;

      if (type === "overlay") {
        const im = this.getOverlayImageElement(obj.src);
        if (im && im.complete && im.naturalWidth) {
          octx.save();
          octx.drawImage(im, obj.x - obj.w / 2, obj.y - obj.h / 2, obj.w, obj.h);
          octx.strokeStyle = "#94A3B8";
          octx.lineWidth = 3;
          octx.strokeRect(obj.x - obj.w / 2, obj.y - obj.h / 2, obj.w, obj.h);
          octx.restore();
        }
      } else if (type === "marker") {
        const fs = (obj.fontSize || 18) / renderScale;
        octx.save();
        octx.font = `800 ${fs}px sans-serif`;
        const wText = Math.max(octx.measureText(obj.text || "").width, 20 / renderScale);
        const padX = 6 / renderScale;
        const padY = 4 / renderScale;
        const w = wText + padX * 2;
        const h = fs + padY * 2;
        octx.fillStyle = "rgba(255,255,255,0.82)";
        octx.beginPath();
        octx.roundRect(obj.x - w / 2, obj.y - h / 2, w, h, 4 / renderScale);
        octx.fill();
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillStyle = obj.color || "#DC2626";
        octx.fillText(obj.text || "", obj.x, obj.y);
        octx.restore();
      } else if (type === "sticker") {
        this.drawPillLabelOnContext(octx, obj.x, obj.y, obj.label || "", obj.bg || "#DC2626", obj.color || "#FFFFFF", obj.fontSize || 15, 0.78, renderScale);
      } else if (type === "line") {
        octx.save();
        const sw = (obj.strokeWidth || 1.8) / renderScale;
        octx.strokeStyle = obj.color || "#2563EB";
        octx.lineWidth = sw;
        octx.beginPath();
        octx.moveTo(obj.x1, obj.y1);
        octx.lineTo(obj.x2, obj.y2);
        octx.stroke();
        if (obj.text) {
          this.drawPillLabelOnContext(octx, (obj.x1 + obj.x2) / 2, (obj.y1 + obj.y2) / 2, obj.text, "#FFFFFF", obj.color || "#2563EB", obj.fontSize || 15, 0.9, renderScale);
        }
        octx.restore();
      } else if (type === "arrow") {
        octx.save();
        const col = obj.color || "#DC2626";
        const sw = (obj.strokeWidth || 1.8) / renderScale;
        octx.strokeStyle = col;
        octx.fillStyle = col;
        octx.lineWidth = sw;
        octx.beginPath();
        octx.moveTo(obj.x1, obj.y1);
        octx.lineTo(obj.x2, obj.y2);
        octx.stroke();
        const ang = Math.atan2(obj.y1 - obj.y2, obj.x1 - obj.x2);
        const headLen = 12 / renderScale;
        octx.beginPath();
        octx.moveTo(obj.x1, obj.y1);
        octx.lineTo(obj.x1 - headLen * Math.cos(ang - Math.PI / 6), obj.y1 - headLen * Math.sin(ang - Math.PI / 6));
        octx.lineTo(obj.x1 - headLen * Math.cos(ang + Math.PI / 6), obj.y1 - headLen * Math.sin(ang + Math.PI / 6));
        octx.closePath();
        octx.fill();
        if (obj.text) {
          this.drawPillLabelOnContext(octx, obj.x2, obj.y2, obj.text, col, "#FFFFFF", obj.fontSize || 16, 0.8, renderScale);
        }
        octx.restore();
      } else if (type === "path" && Array.isArray(obj.points) && obj.points.length > 1) {
        octx.save();
        octx.strokeStyle = obj.color || "#DC2626";
        octx.lineWidth = (obj.strokeWidth || 1.5) / renderScale;
        octx.lineCap = "round";
        octx.lineJoin = "round";
        octx.beginPath();
        octx.moveTo(obj.points[0].x, obj.points[0].y);
        for (let i = 1; i < obj.points.length; i++) octx.lineTo(obj.points[i].x, obj.points[i].y);
        octx.stroke();
        octx.restore();
      }
    }

    const sortedDesc = [...this.selectedItems].sort((a, b) => b.index - a.index);
    sortedDesc.forEach(it => this.deleteObjectAt(it.type, it.index));

    const mergedDataUrl = off.toDataURL("image/jpeg", 0.88);
    this.selectedItems = [];
    this.updateNearToolbar();
    this.imageUrl = mergedDataUrl;
    this.bgImg = new Image();
    this.bgImg.onload = () => this.render();
    this.bgImg.src = mergedDataUrl;

    if (typeof this.navOpts.onBaseImageMerged === "function") {
      await this.navOpts.onBaseImageMerged(mergedDataUrl);
    }
    this.emitSave();
    this.render();
  }

  pushUndoSnapshot() {
    const snap = JSON.stringify({
      imageUrl: this.imageUrl,
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

  async undo() {
    if (!this.undoStack.length) return;
    const prev = JSON.parse(this.undoStack.pop());
    this.lines = prev.lines || [];
    this.markers = prev.markers || [];
    this.paths = prev.paths || [];
    this.arrows = prev.arrows || [];
    this.stickers = prev.stickers || [];
    this.overlays = prev.overlays || [];
    if (prev.imageUrl && prev.imageUrl !== this.imageUrl) {
      this.imageUrl = prev.imageUrl;
      this.bgImg = new Image();
      this.bgImg.onload = () => this.render();
      this.bgImg.src = prev.imageUrl;
      if (typeof this.navOpts.onBaseImageMerged === "function") {
        await this.navOpts.onBaseImageMerged(prev.imageUrl);
      }
    }
    this.selectedItems = [];
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
    if (newMode === "SELECT_SINGLE") {
      this.mode = "SELECT";
      this.multiSelectMode = false;
      if (this.selectedItems.length > 1) {
        this.selectedItems = [this.selectedItems[this.selectedItems.length - 1]];
      }
    } else if (newMode === "SELECT_MULTI") {
      this.mode = "SELECT";
      this.multiSelectMode = true;
    } else {
      this.mode = newMode;
      this.multiSelectMode = false;
    }

    this.rootEl.querySelectorAll(".mc-tool-btn").forEach(b => {
      const m = b.dataset.mode;
      const isAct = (m === newMode) || (newMode === "SELECT" && !this.multiSelectMode && m === "SELECT_SINGLE") || (newMode === "SELECT" && this.multiSelectMode && m === "SELECT_MULTI");
      b.classList.toggle("active", isAct);
    });

    if (typeof this.navOpts.onModeSync === "function") {
      this.navOpts.onModeSync(this.mode);
    }
    if (this.mode !== "SELECT" && this.mode !== "VIEW") {
      this.selectedItems = [];
    }
    this.updateNearToolbar();
    this.render();
  }

  setActiveColor(col) {
    this.activeColor = col;
    if (this.selectedItems.length) {
      this.pushUndoSnapshot();
      this.selectedItems.forEach(it => {
        const obj = this.getObjectByTypeAndIndex(it.type, it.index);
        if (!obj || it.type === "overlay") return;
        obj.color = col;
        if (it.type === "sticker") {
          obj.bg = col === "#FFFFFF" ? "#0F172A" : col;
          obj.color = "#FFFFFF";
        }
      });
      this.emitSave();
      this.render();
    }
  }

  setStrokeWidth(val) {
    this.strokeWidth = val;
    if (this.selectedItems.length) {
      this.selectedItems.forEach(it => {
        const obj = this.getObjectByTypeAndIndex(it.type, it.index);
        if (obj && (it.type === "path" || it.type === "line" || it.type === "arrow")) {
          obj.strokeWidth = val;
        }
      });
      this.render();
    }
  }

  resetZoom() {
    this.fitImageToScreen();
    this.updateNearToolbar();
    this.render();
  }

  makeFloatingBoxDraggable(boxEl, handleEl) {
    if (!boxEl || !handleEl) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    handleEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseFloat(boxEl.style.left) || boxEl.offsetLeft;
      origTop = parseFloat(boxEl.style.top) || boxEl.offsetTop;
      handleEl.setPointerCapture(e.pointerId);
    });

    handleEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxL = Math.max(8, this.viewW - boxEl.offsetWidth - 8);
      const maxT = Math.max(44, this.viewH - boxEl.offsetHeight - 8);
      boxEl.style.left = `${Math.max(8, Math.min(maxL, origLeft + dx))}px`;
      boxEl.style.top = `${Math.max(44, Math.min(maxT, origTop + dy))}px`;
    });

    const endDrag = () => { dragging = false; };
    handleEl.addEventListener("pointerup", endDrag);
    handleEl.addEventListener("pointercancel", endDrag);
  }

  buildDOM() {
    const quickColors = this.colors.slice(0, 6);
    this.container.innerHTML = `
      <div class="mc-root" style="position:relative; width:100%; height:100%; background:#F8FAFC; overflow:hidden; user-select:none; touch-action:none;">
        <canvas class="mc-canvas" style="display:block; width:100%; height:100%; background:#F8FAFC;"></canvas>

        <!-- 精簡合併工具列：直接並排「單選」「多選」 -->
        <div class="mc-topbar" style="position:absolute; top:8px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:3px; padding:4px 8px; background:rgba(255,255,255,0.96); border:1px solid #CBD5E1; border-radius:999px; box-shadow:0 4px 14px rgba(15,23,42,0.1); z-index:20; max-width:96vw; overflow-x:auto;">
          <button class="mc-tool-btn" data-mode="RULER">拉尺</button>
          <button class="mc-tool-btn" data-mode="PEN">畫筆</button>
          <button class="mc-tool-btn" data-mode="TEXT">文字</button>
          <button type="button" class="mc-overlay-pick-btn" style="background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 9px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap;">貼圖</button>

          <span style="color:#CBD5E1; font-weight:300;">|</span>

          <button class="mc-tool-btn active" data-mode="VIEW">檢視</button>
          <button class="mc-tool-btn" data-mode="SELECT_SINGLE">單選</button>
          <button class="mc-tool-btn" data-mode="SELECT_MULTI">多選</button>
          <button class="mc-undo-btn" disabled style="background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap; opacity:0.4;">復原</button>
          <button class="mc-tool-btn" data-mode="ERASER">擦除</button>
        </div>

        <input type="file" class="mc-overlay-file-input hidden" accept="image/*" />

        <!-- 選中物件的小工具條（支援單選與多選批量操作） -->
        <div class="mc-near-toolbar" style="position:absolute; display:none; align-items:center; gap:5px; padding:5px 9px; background:rgba(15,23,42,0.95); color:#FFF; border-radius:999px; box-shadow:0 6px 18px rgba(0,0,0,0.32); z-index:35; white-space:nowrap;">
          <span class="mc-near-count hidden" style="background:#2563EB; color:#FFF; font-size:10px; font-weight:800; padding:1px 6px; border-radius:999px;">已選2項</span>
          <button type="button" class="mc-near-dec" title="縮小 / 變幼" style="background:#334155; color:#FFF; border:none; border-radius:999px; width:22px; height:22px; font-size:13px; font-weight:800; cursor:pointer; line-height:1;">‹</button>
          <span class="mc-near-val" style="font-size:11px; font-weight:700; min-width:24px; text-align:center; color:#E2E8F0;">18</span>
          <button type="button" class="mc-near-inc" title="放大 / 變粗" style="background:#334155; color:#FFF; border:none; border-radius:999px; width:22px; height:22px; font-size:13px; font-weight:800; cursor:pointer; line-height:1;">›</button>

          <div class="mc-near-colors-wrap" style="display:flex; align-items:center; gap:3px; padding-left:4px; border-left:1px solid #475569;">
            ${quickColors.map(c => `
              <button type="button" class="mc-near-color" data-ncol="${c}"
                      style="width:14px; height:14px; border-radius:50%; background-color:${c}; border:1.5px solid #94A3B8; cursor:pointer; padding:0;"></button>
            `).join("")}
          </div>

          <button type="button" class="mc-near-merge" title="合併到底圖成為一張更新圖片" style="background:#059669; color:#FFF; border:none; border-radius:999px; padding:3px 9px; font-size:11px; font-weight:800; cursor:pointer;">合併到底圖</button>
          <button type="button" class="mc-near-edit" title="改字" style="background:#334155; color:#FFF; border:none; border-radius:999px; padding:3px 7px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">改字</button>
          <button type="button" class="mc-near-del" title="刪除" style="background:#EF4444; color:#FFF; border:none; border-radius:999px; padding:3px 7px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">刪除</button>
        </div>

        <!-- 拉高加寬版「尺寸標註」浮窗：inputmode="none" 不觸發系統鍵盤，內建專屬數字小按鍵 -->
        <div class="mc-ruler-box hidden" style="position:absolute; width:min(410px, 95vw); background:#FFF; border:1.5px solid #0F172A; border-radius:10px; padding:8px; box-shadow:0 14px 32px rgba(15,23,42,0.28); z-index:48; display:flex; flex-direction:column; gap:7px;">
          <div class="mc-ruler-drag-handle" style="display:flex; justify-content:space-between; align-items:center; background:#F1F5F9; padding:3px 7px; border-radius:5px; cursor:grab; font-size:11px; color:#475569;">
            <strong>⠿ 尺寸標註 <span style="font-weight:400;">(按住此列可拖動)</span></strong>
            <button type="button" class="mc-ruler-cancel" style="background:none; border:none; color:#64748B; font-size:12px; font-weight:700; cursor:pointer;">✕</button>
          </div>

          <div style="display:flex; gap:5px;">
            <input type="text" inputmode="none" class="mc-ruler-input" placeholder="點下方數字 / 詞彙（不彈系統鍵盤）"
                   style="flex:1; min-width:0; padding:6px 9px; border:1.5px solid #2563EB; border-radius:6px; font-size:14px; font-weight:700; background:#FFF;" />
            <button type="button" class="mc-ruler-ok" style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:6px 14px; font-size:12px; font-weight:800; cursor:pointer;">確定</button>
          </div>

          <!-- 內建防遮擋數字鍵盤（完全不觸發 iOS / Android 系統鍵盤） -->
          <div class="mc-ruler-numpad" style="display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; background:#F1F5F9; padding:4px; border-radius:6px; border:1px solid #CBD5E1;">
            ${["1","2","3","4","5","6","7","8","9","0",".","×","⌫","清空"].map(k => `
              <button type="button" class="mc-rnum-btn" data-rnum="${k}"
                      style="background:${k === "⌫" || k === "清空" ? "#E2E8F0" : "#FFF"}; color:#0F172A; border:1px solid #CBD5E1; border-radius:4px; padding:5px 0; font-size:13px; font-weight:800; cursor:pointer;">
                ${k}
              </button>
            `).join("")}
          </div>

          <!-- 智慧分格尺寸輸入區（點選 (闊高厚)/(闊高深)/(高厚)/(闊高) 自動展開） -->
          <div class="mc-ruler-split-box hidden" style="background:#EFF6FF; border:1.5px solid #3B82F6; border-radius:7px; padding:6px; display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong class="mc-rsplit-title" style="font-size:12px; color:#1E40AF;">明喉</strong>
              <button type="button" class="mc-rsplit-close" style="background:none; border:none; color:#64748B; font-size:11px; cursor:pointer;">收起</button>
            </div>
            <div class="mc-rsplit-inputs" style="display:flex; align-items:center; gap:4px;"></div>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:4px;">
            ${RULER_QUICK_WORDS.map(w => `
              <button type="button" class="mc-rword-btn" data-rword="${w}"
                      style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:5px; padding:3px 9px; font-size:12px; font-weight:800; cursor:pointer;">
                ${w}
              </button>
            `).join("")}
          </div>

          <!-- 動態渲染：高 / 留位 / 構造 + 電掣 / 水煤 / 收口/結構 等雲端詞庫分類 -->
          <div class="mc-ruler-cats" style="display:flex; flex-wrap:wrap; gap:4px; border-top:1px solid #E2E8F0; padding-top:6px;"></div>

          <!-- 拉高詞彙區至 220px，減少滾動 -->
          <div class="mc-ruler-items" style="max-height:220px; overflow-y:auto; display:flex; flex-wrap:wrap; gap:5px; background:#F8FAFC; padding:7px; border-radius:6px; border:1px solid #E2E8F0;"></div>

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <button type="button" class="mc-ruler-cancel-btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:4px; padding:3px 9px; font-size:11px; cursor:pointer;">取消</button>
            <button type="button" class="mc-ruler-dict-btn" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #93C5FD; border-radius:4px; padding:3px 9px; font-size:11px; font-weight:700; cursor:pointer;">詞庫</button>
          </div>
        </div>

        <!-- 普通純打字極簡小框 -->
        <div class="mc-plain-text-box hidden" style="position:absolute; width:min(220px, 84vw); background:#FFF; border:1.5px solid #0F172A; border-radius:8px; padding:6px; box-shadow:0 8px 20px rgba(15,23,42,0.2); z-index:46; display:flex; flex-direction:column; gap:5px;">
          <input type="text" class="mc-plain-input" placeholder="輸入文字或數字..."
                 style="width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #CBD5E1; border-radius:5px; font-size:13px;" />
          <div style="display:flex; justify-content:flex-end; gap:5px;">
            <button type="button" class="mc-plain-cancel" style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer;">取消</button>
            <button type="button" class="mc-plain-ok" style="background:#0F172A; color:#FFF; border:none; border-radius:4px; padding:2px 9px; font-size:11px; font-weight:700; cursor:pointer;">確定</button>
          </div>
        </div>

        <!-- 拉高版「箭頭批改」浮窗 -->
        <div class="mc-arrow-box hidden" style="position:absolute; width:min(330px, 92vw); background:#FFF; border:1.5px solid #2563EB; border-radius:9px; padding:7px; box-shadow:0 12px 28px rgba(15,23,42,0.24); z-index:45; display:flex; flex-direction:column; gap:6px;">
          <div class="mc-arrow-drag-handle" style="display:flex; justify-content:space-between; align-items:center; background:#EFF6FF; padding:3px 6px; border-radius:4px; cursor:grab; font-size:10px; color:#1D4ED8;">
            <strong>⠿ 箭頭批改 <span style="font-weight:400;">(按住可拖動)</span></strong>
            <button type="button" class="mc-manage-phrase-btn" style="background:#FFF; border:1px solid #93C5FD; border-radius:4px; padding:1px 6px; font-size:10px; font-weight:700; color:#1D4ED8; cursor:pointer;">短語庫</button>
          </div>

          <div class="mc-arrow-status-row" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px;">
            ${ARROW_STATUS_BUTTONS.map(sb => `
              <button type="button" class="mc-st-pill" data-stkey="${sb.key}"
                      style="background:${sb.bg}; color:${sb.fg}; border:1.5px solid ${sb.border}; border-radius:5px; padding:4px 2px; font-size:11px; font-weight:800; cursor:pointer; text-align:center; white-space:nowrap;">
                ${sb.label}
              </button>
            `).join("")}
          </div>

          <input type="text" class="mc-arrow-input" placeholder="輸入批改字句或點下方雲端短語..."
                 style="width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #93C5FD; border-radius:5px; font-size:12px;" />

          <div style="display:flex; gap:4px; overflow-x:auto;" class="mc-phrase-cats"></div>
          <!-- 拉高短語列表至 225px -->
          <div style="max-height:225px; overflow-y:auto; display:flex; flex-direction:column; gap:3px; background:#F8FAFC; padding:5px; border-radius:5px; border:1px solid #E2E8F0;" class="mc-phrase-items"></div>

          <div style="display:flex; justify-content:flex-end; gap:5px;">
            <button type="button" class="mc-arrow-cancel" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:4px; padding:3px 9px; font-size:11px; cursor:pointer;">取消</button>
            <button type="button" class="mc-arrow-ok" style="background:#2563EB; color:#FFF; border:none; border-radius:4px; padding:3px 12px; font-size:11px; font-weight:800; cursor:pointer;">貼上批改</button>
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
    this.rulerBox = this.container.querySelector(".mc-ruler-box");
    this.rulerInput = this.container.querySelector(".mc-ruler-input");
    this.plainTextBox = this.container.querySelector(".mc-plain-text-box");
    this.plainInput = this.container.querySelector(".mc-plain-input");
    this.arrowBox = this.container.querySelector(".mc-arrow-box");
    this.arrowInput = this.container.querySelector(".mc-arrow-input");

    this.makeFloatingBoxDraggable(this.rulerBox, this.rulerBox.querySelector(".mc-ruler-drag-handle"));
    this.makeFloatingBoxDraggable(this.arrowBox, this.arrowBox.querySelector(".mc-arrow-drag-handle"));

    const styleTag = document.createElement("style");
    styleTag.textContent = `
      .mc-tool-btn { background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 9px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap; }
      .mc-tool-btn.active { background:#EFF6FF; border-color:#3B82F6; color:#1D4ED8; }
      .mc-st-pill.active { outline: 2px solid #0F172A; }
    `;
    this.rootEl.appendChild(styleTag);

    this.resizeCanvas();
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
    this.fitScale = s;
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

    const prevBtn = this.rootEl.querySelector(".mc-nav-prev");
    if (prevBtn && this.navOpts.onPrev) prevBtn.onclick = () => this.navOpts.onPrev();
    const nextBtn = this.rootEl.querySelector(".mc-nav-next");
    if (nextBtn && this.navOpts.onNext) nextBtn.onclick = () => this.navOpts.onNext();

    const adjustSelectedSize = (delta) => {
      if (!this.selectedItems.length) return;
      this.pushUndoSnapshot();
      this.selectedItems.forEach(it => {
        const obj = this.getObjectByTypeAndIndex(it.type, it.index);
        if (!obj) return;
        if (it.type === "overlay") {
          const factor = delta > 0 ? 1.15 : 0.87;
          obj.w = Math.max(40, obj.w * factor);
          obj.h = Math.max(40, obj.h * factor);
        } else if (it.type === "marker" || it.type === "sticker" || it.type === "arrow" || it.type === "line") {
          const cur = obj.fontSize || (it.type === "line" ? 15 : 18);
          const step = Math.max(2, Math.round(cur * 0.14));
          obj.fontSize = Math.min(120, Math.max(10, cur + (delta > 0 ? step : -step)));
        } else {
          obj.strokeWidth = Math.min(10, Math.max(0.5, Number(((obj.strokeWidth || 1.5) + (delta > 0 ? 0.5 : -0.5)).toFixed(1))));
        }
      });
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };

    this.nearToolbar.querySelector(".mc-near-dec").onclick = () => adjustSelectedSize(-2);
    this.nearToolbar.querySelector(".mc-near-inc").onclick = () => adjustSelectedSize(2);

    this.nearToolbar.querySelector(".mc-near-merge").onclick = async () => {
      if (!this.selectedItems.length) return;
      await this.flattenSelectedItemsIntoBase();
    };

    this.nearToolbar.querySelectorAll(".mc-near-color").forEach(btn => {
      btn.onclick = () => {
        if (!this.selectedItems.length) return;
        this.pushUndoSnapshot();
        const col = btn.dataset.ncol;
        this.selectedItems.forEach(it => {
          const obj = this.getObjectByTypeAndIndex(it.type, it.index);
          if (!obj || it.type === "overlay") return;
          if (it.type === "sticker") {
            obj.bg = col === "#FFFFFF" ? "#0F172A" : col;
            obj.color = "#FFFFFF";
          } else {
            obj.color = col;
          }
        });
        this.emitSave();
        this.render();
      };
    });

    this.nearToolbar.querySelector(".mc-near-edit").onclick = () => {
      if (this.selectedItems.length !== 1) return;
      const single = this.selectedItems[0];
      const obj = this.getObjectByTypeAndIndex(single.type, single.index);
      if (!obj) return;
      const anchor = this.getObjectAnchorImg(single.type, obj);
      const scr = this.imgToScreen(anchor.x, anchor.y);
      if (single.type === "arrow") {
        this.openArrowEditor(scr.x, scr.y, obj.text || "", obj.status || "NEED_FIX", (newTxt, newStatus) => {
          this.pushUndoSnapshot();
          obj.text = newTxt;
          obj.status = newStatus;
          this.emitSave(newTxt.trim() ? `[${this.formatStatusLabel(newStatus)}] ${newTxt.trim()}` : "", newStatus);
          this.updateNearToolbar();
          this.render();
        });
      } else if (single.type === "line") {
        this.openRulerEditor(scr.x, scr.y, obj.text || "", (newTxt) => {
          this.pushUndoSnapshot();
          obj.text = newTxt;
          this.emitSave();
          this.updateNearToolbar();
          this.render();
        });
      } else {
        this.openPlainTextEditor(scr.x, scr.y, obj.text || obj.label || "", (newTxt) => {
          this.pushUndoSnapshot();
          if (single.type === "sticker") obj.label = newTxt;
          else obj.text = newTxt;
          this.emitSave();
          this.updateNearToolbar();
          this.render();
        });
      }
    };

    this.nearToolbar.querySelector(".mc-near-del").onclick = () => {
      if (!this.selectedItems.length) return;
      this.pushUndoSnapshot();
      const sortedDesc = [...this.selectedItems].sort((a, b) => b.index - a.index);
      sortedDesc.forEach(it => this.deleteObjectAt(it.type, it.index));
      this.selectedItems = [];
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };

    // 追蹤目前聚焦的是主輸入框還是分格輸入框（完全不觸發系統鍵盤）
    this.activeRulerTargetInput = this.rulerInput;
    this.rulerInput.addEventListener("focus", () => { this.activeRulerTargetInput = this.rulerInput; });
    this.rulerBox.addEventListener("focusin", (e) => {
      if (e.target && (e.target.classList.contains("mc-ruler-input") || e.target.classList.contains("mc-rsplit-field"))) {
        this.activeRulerTargetInput = e.target;
      }
    });

    this.rulerBox.querySelectorAll(".mc-rnum-btn").forEach(btn => {
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = () => {
        const key = btn.dataset.rnum;
        const target = (this.activeRulerTargetInput && document.body.contains(this.activeRulerTargetInput))
          ? this.activeRulerTargetInput
          : this.rulerInput;
        if (key === "清空") {
          target.value = "";
        } else if (key === "⌫") {
          target.value = target.value.slice(0, -1);
        } else {
          target.value = `${target.value}${key}`;
        }
        target.dispatchEvent(new Event("input", { bubbles: true }));
      };
    });

    const appendRulerToken = (tok) => {
      const cur = this.rulerInput.value.trim();
      this.rulerInput.value = cur ? `${cur} ${tok}` : tok;
    };
    this.rulerBox.querySelectorAll(".mc-rword-btn").forEach(b => {
      b.onclick = () => appendRulerToken(b.dataset.rword);
    });
    this.rulerBox.querySelector(".mc-ruler-cancel").onclick = () => {
      this.rulerBox.classList.add("hidden");
      this.pendingRulerAction = null;
      this.updateNearToolbar();
    };
    this.rulerBox.querySelector(".mc-ruler-cancel-btn").onclick = () => {
      this.rulerBox.classList.add("hidden");
      this.pendingRulerAction = null;
      this.updateNearToolbar();
    };
    this.rulerBox.querySelector(".mc-ruler-ok").onclick = () => this.commitRulerEditor(true);
    this.rulerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitRulerEditor(true); }
    });
    this.rulerBox.querySelector(".mc-ruler-dict-btn").onclick = () => {
      if (typeof this.navOpts.onOpenDictManager === "function") {
        this.navOpts.onOpenDictManager("STAMP", () => this.renderRulerItemsUI());
      }
    };

    // 純文字小框事件
    this.plainTextBox.querySelector(".mc-plain-cancel").onclick = () => {
      this.plainTextBox.classList.add("hidden");
      this.pendingPlainTextAction = null;
      this.updateNearToolbar();
    };
    this.plainTextBox.querySelector(".mc-plain-ok").onclick = () => this.commitPlainText(true);
    this.plainInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitPlainText(true); }
    });

    // 箭頭批改浮窗事件
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
      this.updateNearToolbar();
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
        this.marqueeRect = null;
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

  startDragSelectedGroup(startImgPt) {
    const snapshots = this.selectedItems.map(it => ({
      ...it,
      orig: JSON.parse(JSON.stringify(this.getObjectByTypeAndIndex(it.type, it.index)))
    }));
    this.dragGroupState = { startImg: startImgPt, moved: false, snapshots };
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
        this.setSingleSelection(hit);
        const obj = this.getObjectByTypeAndIndex(hit.type, hit.index);
        if (hit.type === "arrow") {
          this.openArrowEditor(sx, sy, obj.text || "", obj.status || "NEED_FIX", (newTxt, newStatus) => {
            this.pushUndoSnapshot();
            obj.text = newTxt;
            obj.status = newStatus;
            this.emitSave(newTxt.trim() ? `[${this.formatStatusLabel(newStatus)}] ${newTxt.trim()}` : "", newStatus);
            this.updateNearToolbar();
            this.render();
          });
        } else if (hit.type === "line") {
          this.openRulerEditor(sx, sy, obj.text || "", (newTxt) => {
            this.pushUndoSnapshot();
            obj.text = newTxt;
            this.emitSave();
            this.updateNearToolbar();
            this.render();
          });
        } else {
          this.openPlainTextEditor(sx, sy, obj.text || obj.label || "", (newTxt) => {
            this.pushUndoSnapshot();
            if (hit.type === "sticker") obj.label = newTxt;
            else obj.text = newTxt;
            this.emitSave();
            this.updateNearToolbar();
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
      if (this.selectedItems.length) {
        this.selectedItems = [];
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
        this.selectedItems = [];
        this.updateNearToolbar();
        this.emitSave();
        this.render();
      }
      return;
    }

    if (this.mode === "SELECT") {
      const hit = this.hitTest(pt.x, pt.y);
      if (hit) {
        if (this.multiSelectMode) {
          this.toggleSelectionItem(hit);
          if (this.selectedItems.length) this.startDragSelectedGroup(pt);
        } else {
          if (!this.isItemSelected(hit.type, hit.index)) this.setSingleSelection(hit);
          this.startDragSelectedGroup(pt);
        }
        this.updateNearToolbar();
        this.render();
      } else {
        if (this.multiSelectMode) {
          this.marqueeRect = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
        } else {
          this.selectedItems = [];
          this.updateNearToolbar();
          this.isPanning = true;
          this.panStart = { x: sx - this.offsetX, y: sy - this.offsetY };
        }
        this.render();
      }
      return;
    }

    if (this.mode === "TEXT") {
      const adaptiveFs = this.getAdaptiveFontSize(18);
      this.openPlainTextEditor(sx, sy, "", (txt) => {
        if (!txt.trim()) {
          this.setMode("VIEW");
          this.updateNearToolbar();
          return;
        }
        this.pushUndoSnapshot();
        this.markers.push({
          x: pt.x, y: pt.y,
          text: txt.trim(),
          color: this.activeColor,
          fontSize: adaptiveFs
        });
        this.setSingleSelection({ type: "marker", index: this.markers.length - 1 });
        this.setMode("VIEW");
        this.updateNearToolbar();
        this.emitSave();
        this.render();
      });
      return;
    }

    if (this.mode === "ARROW") {
      this.isDrawing = true;
      this.draftObj = {
        type: "arrow",
        x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
        color: this.activeColor,
        strokeWidth: this.strokeWidth,
        fontSize: this.getAdaptiveFontSize(16),
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
        fontSize: this.getAdaptiveFontSize(15),
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

    if (this.marqueeRect) {
      this.marqueeRect.x2 = pt.x;
      this.marqueeRect.y2 = pt.y;
      this.render();
      return;
    }

    if (this.dragGroupState) {
      const dx = pt.x - this.dragGroupState.startImg.x;
      const dy = pt.y - this.dragGroupState.startImg.y;
      if (!this.dragGroupState.moved && Math.hypot(dx, dy) > 2 / this.scale) {
        this.pushUndoSnapshot();
        this.dragGroupState.moved = true;
      }
      this.dragGroupState.snapshots.forEach(snap => {
        const obj = this.getObjectByTypeAndIndex(snap.type, snap.index);
        const orig = snap.orig;
        if (!obj || !orig) return;
        if (snap.type === "marker" || snap.type === "sticker" || snap.type === "overlay") {
          obj.x = orig.x + dx; obj.y = orig.y + dy;
        } else if (snap.type === "line" || snap.type === "arrow") {
          obj.x1 = orig.x1 + dx; obj.y1 = orig.y1 + dy;
          obj.x2 = orig.x2 + dx; obj.y2 = orig.y2 + dy;
        } else if (snap.type === "path" && Array.isArray(orig.points)) {
          obj.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        }
      });
      this.updateNearToolbar();
      this.render();
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

    if (this.marqueeRect) {
      const minX = Math.min(this.marqueeRect.x1, this.marqueeRect.x2);
      const maxX = Math.max(this.marqueeRect.x1, this.marqueeRect.x2);
      const minY = Math.min(this.marqueeRect.y1, this.marqueeRect.y2);
      const maxY = Math.max(this.marqueeRect.y1, this.marqueeRect.y2);
      this.marqueeRect = null;

      if (maxX - minX > 6 / this.scale || maxY - minY > 6 / this.scale) {
        const inBox = (ix, iy) => ix >= minX && ix <= maxX && iy >= minY && iy <= maxY;
        const addIfNew = (type, index) => {
          if (!this.isItemSelected(type, index)) this.selectedItems.push({ type, index });
        };
        this.markers.forEach((m, i) => { if (inBox(m.x, m.y)) addIfNew("marker", i); });
        this.stickers.forEach((s, i) => { if (inBox(s.x, s.y)) addIfNew("sticker", i); });
        this.lines.forEach((l, i) => { if (inBox(l.x1, l.y1) || inBox(l.x2, l.y2) || inBox((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2)) addIfNew("line", i); });
        this.arrows.forEach((a, i) => { if (inBox(a.x1, a.y1) || inBox(a.x2, a.y2)) addIfNew("arrow", i); });
        this.paths.forEach((p, i) => { if ((p.points || []).some(pt => inBox(pt.x, pt.y))) addIfNew("path", i); });
        this.overlays.forEach((ov, i) => { if (inBox(ov.x, ov.y)) addIfNew("overlay", i); });
      }
      this.updateNearToolbar();
      this.render();
      return;
    }

    if (this.dragGroupState) {
      const didMove = this.dragGroupState.moved;
      this.dragGroupState = null;
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
      this.setSingleSelection({ type: "arrow", index: this.arrows.length - 1 });
      this.render();

      const tailScr = this.imgToScreen(finished.x2, finished.y2);
      this.openArrowEditor(tailScr.x, tailScr.y, "", "NEED_FIX", (txt, status) => {
        const cleanTxt = txt.trim();
        finished.text = cleanTxt || this.formatStatusLabel(status);
        finished.status = status;
        this.setMode("VIEW");
        this.updateNearToolbar();
        this.emitSave(cleanTxt ? `[${this.formatStatusLabel(status)}] ${cleanTxt}` : "", status);
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
      this.setSingleSelection({ type: "line", index: this.lines.length - 1 });
      this.render();

      const midScr = this.imgToScreen((finished.x1 + finished.x2) / 2, (finished.y1 + finished.y2) / 2);
      this.openRulerEditor(midScr.x, midScr.y, "", (txt) => {
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
      this.setSingleSelection({ type: "path", index: this.paths.length - 1 });
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    }
  }

  formatStatusLabel(st) {
    if (st === "OK") return "確認";
    if (st === "SITE_CHECK") return "再核對";
    if (st === "NEED_INFO") return "待補資料";
    return "需改";
  }

  hideAllEditors() {
    this.plainTextBox.classList.add("hidden");
    this.arrowBox.classList.add("hidden");
    this.rulerBox.classList.add("hidden");
  }

  openRulerEditor(screenX, screenY, initialText, onConfirm) {
    this.hideAllEditors();
    this.nearToolbar.style.display = "none";
    this.pendingRulerAction = onConfirm;
    this.rulerInput.value = initialText || "";
    this.activeRulerTargetInput = this.rulerInput;
    this.rulerBox.querySelector(".mc-ruler-split-box")?.classList.add("hidden");
    this.rulerBox.classList.remove("hidden");

    const boxW = Math.min(410, this.viewW * 0.95);
    const boxH = 420;
    const left = Math.max(8, Math.min(this.viewW - boxW - 8, screenX - boxW / 2));
    const top = screenY + 24 + boxH > this.viewH ? Math.max(48, this.viewH - boxH - 12) : Math.max(48, screenY + 16);
    this.rulerBox.style.left = `${left}px`;
    this.rulerBox.style.top = `${top}px`;
    this.renderRulerItemsUI();
  }

  openRulerMultiDimSplit(baseName, dimsStr) {
    const splitBox = this.rulerBox.querySelector(".mc-ruler-split-box");
    const titleEl = this.rulerBox.querySelector(".mc-rsplit-title");
    const inputsEl = this.rulerBox.querySelector(".mc-rsplit-inputs");
    const closeBtn = this.rulerBox.querySelector(".mc-rsplit-close");
    if (!splitBox || !inputsEl) return;

    const labels = dimsStr.split("");
    titleEl.textContent = `${baseName}（分別填寫 ${labels.join(" × ")}）`;
    splitBox.classList.remove("hidden");

    closeBtn.onclick = () => {
      splitBox.classList.add("hidden");
      this.activeRulerTargetInput = this.rulerInput;
    };

    inputsEl.innerHTML = labels.map((lbl, idx) => `
      ${idx > 0 ? `<span style="color:#64748B; font-weight:800;">×</span>` : ""}
      <input type="text" inputmode="none" class="mc-rsplit-field" data-dim="${lbl}" placeholder="${lbl}"
             style="flex:1; min-width:0; padding:5px 6px; border:1.5px solid #2563EB; border-radius:5px; font-size:13px; font-weight:800; text-align:center; background:#FFF;" />
    `).join("") + `
      <button type="button" class="mc-rsplit-apply"
              style="background:#2563EB; color:#FFF; border:none; border-radius:5px; padding:5px 9px; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap;">
        填入
      </button>
    `;

    const fieldEls = Array.from(inputsEl.querySelectorAll(".mc-rsplit-field"));
    const syncToMainInput = () => {
      const vals = fieldEls.map(f => f.value.trim()).filter(Boolean);
      this.rulerInput.value = vals.length ? `${baseName} ${vals.join("×")}` : baseName;
    };

    fieldEls.forEach((inp, idx) => {
      inp.addEventListener("input", syncToMainInput);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (idx < fieldEls.length - 1) {
            fieldEls[idx + 1].focus();
          } else {
            syncToMainInput();
            this.commitRulerEditor(true);
          }
        }
      });
    });

    inputsEl.querySelector(".mc-rsplit-apply").onclick = () => {
      syncToMainInput();
      splitBox.classList.add("hidden");
      this.activeRulerTargetInput = this.rulerInput;
    };

    if (fieldEls[0]) {
      this.activeRulerTargetInput = fieldEls[0];
      fieldEls[0].focus();
    }
  }

  renderRulerItemsUI() {
    const catsEl = this.rulerBox.querySelector(".mc-ruler-cats");
    const itemsEl = this.rulerBox.querySelector(".mc-ruler-items");
    const stampGroups = this.getStampGroups();

    const allTabs = [
      { key: "高", label: "高", items: RULER_CATEGORY_ITEMS["高"] },
      { key: "留位", label: "留位", items: RULER_CATEGORY_ITEMS["留位"] },
      { key: "構造", label: "構造", items: RULER_CATEGORY_ITEMS["構造"] },
      ...stampGroups.map(g => ({ key: `GRP_${g.name}`, label: g.name, items: g.items || [] }))
    ];

    if (!allTabs.some(t => t.key === this.activeRulerCat)) {
      this.activeRulerCat = "高";
    }

    catsEl.innerHTML = allTabs.map(t => {
      const active = t.key === this.activeRulerCat;
      return `
        <button type="button" class="mc-rcat-btn" data-rcat="${t.key}"
                style="padding:3px 9px; font-size:11px; border-radius:5px; border:1px solid ${active ? "#0F172A" : "#CBD5E1"}; background:${active ? "#0F172A" : "#F8FAFC"}; color:${active ? "#FFF" : "#334155"}; font-weight:800; cursor:pointer; white-space:nowrap;">
          ${t.label}
        </button>
      `;
    }).join("");

    catsEl.querySelectorAll(".mc-rcat-btn").forEach(b => {
      b.onclick = () => {
        this.activeRulerCat = b.dataset.rcat;
        this.renderRulerItemsUI();
      };
    });

    const curTab = allTabs.find(t => t.key === this.activeRulerCat) || allTabs[0];
    const list = curTab?.items || [];

    if (!list.length) {
      itemsEl.innerHTML = `<div style="font-size:11px; color:#64748B;">此分類尚無項目，點右下「詞庫」新增。</div>`;
      return;
    }

    itemsEl.innerHTML = list.map(lbl => `
      <button type="button" class="mc-ritem-btn" data-ritem="${lbl}"
              style="background:#FFF; border:1px solid #CBD5E1; border-radius:5px; padding:3px 8px; font-size:12px; font-weight:700; color:#1E293B; cursor:pointer;">
        ${lbl}
      </button>
    `).join("");

    itemsEl.querySelectorAll(".mc-ritem-btn").forEach(b => {
      b.onclick = () => {
        const raw = b.dataset.ritem;
        const match = raw.match(/^(.+?)\(([闊高深厚]+)\)$/);
        if (match) {
          this.openRulerMultiDimSplit(match[1].trim(), match[2]);
          return;
        }
        this.rulerBox.querySelector(".mc-ruler-split-box")?.classList.add("hidden");
        this.activeRulerTargetInput = this.rulerInput;
        const cur = this.rulerInput.value.trim();
        this.rulerInput.value = cur ? `${cur} ${raw}` : raw;
      };
    });
  }

  commitRulerEditor(shouldSave = true) {
    if (!this.pendingRulerAction) return;
    const val = this.rulerInput.value;
    const fn = this.pendingRulerAction;
    this.pendingRulerAction = null;
    this.rulerBox.classList.add("hidden");
    if (shouldSave) fn(val);
    this.updateNearToolbar();
  }

  openPlainTextEditor(screenX, screenY, initialText, onConfirm) {
    this.hideAllEditors();
    this.nearToolbar.style.display = "none";
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
    this.updateNearToolbar();
  }

  openArrowEditor(screenX, screenY, initialText, initialStatus, onConfirm) {
    this.hideAllEditors();
    this.nearToolbar.style.display = "none";
    this.pendingArrowAction = onConfirm;
    this.arrowInput.value = initialText || "";
    this.selectedArrowStatus = initialStatus || "NEED_FIX";
    this.updateArrowStatusPills();

    this.arrowBox.classList.remove("hidden");
    const boxW = Math.min(330, this.viewW * 0.92);
    const boxH = 365;
    const left = Math.max(10, Math.min(this.viewW - boxW - 10, screenX - boxW / 2));
    const top = screenY + 24 + boxH > this.viewH ? Math.max(48, this.viewH - boxH - 12) : Math.max(48, screenY + 18);

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
      itemsEl.innerHTML = `<div style="font-size:10px; color:#64748B; padding:3px;">雲端尚未建立短語，點右上「短語庫」新增或匯入範本。</div>`;
      return;
    }

    const cats = ["全部", ...new Set(phrases.map(p => p.cat || "常用"))];
    catsEl.innerHTML = cats.map(c => `
      <button type="button" class="mc-pcat-btn" data-pcat="${c}"
              style="padding:2px 7px; font-size:11px; border-radius:4px; border:1px solid ${this.activePhraseCat === c ? "#2563EB" : "#CBD5E1"}; background:${this.activePhraseCat === c ? "#DBEAFE" : "#FFF"}; color:${this.activePhraseCat === c ? "#1D4ED8" : "#475569"}; font-weight:700; cursor:pointer; white-space:nowrap;">
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
              style="text-align:left; background:#FFF; border:1px solid #E2E8F0; border-radius:4px; padding:4px 7px; font-size:11px; color:#1E293B; cursor:pointer;">
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
    this.updateNearToolbar();
  }

  commitInline(shouldSave = false) {
    this.commitRulerEditor(shouldSave);
    this.commitPlainText(shouldSave);
    this.commitArrowEditor(shouldSave);
  }

  getObjectByTypeAndIndex(type, index) {
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
    if (!this.selectedItems.length || this.isAnyEditorOpen()) {
      this.nearToolbar.style.display = "none";
      return;
    }

    const lastSel = this.selectedItems[this.selectedItems.length - 1];
    const obj = this.getObjectByTypeAndIndex(lastSel.type, lastSel.index);
    if (!obj) {
      this.nearToolbar.style.display = "none";
      return;
    }

    const anchor = this.getObjectAnchorImg(lastSel.type, obj);
    const scr = this.imgToScreen(anchor.x, anchor.y);

    const countEl = this.nearToolbar.querySelector(".mc-near-count");
    const valEl = this.nearToolbar.querySelector(".mc-near-val");
    const editBtn = this.nearToolbar.querySelector(".mc-near-edit");
    const colorsWrap = this.nearToolbar.querySelector(".mc-near-colors-wrap");

    if (this.selectedItems.length > 1) {
      countEl.textContent = `已選${this.selectedItems.length}項`;
      countEl.classList.remove("hidden");
      editBtn.style.display = "none";
      colorsWrap.style.display = "flex";
      valEl.textContent = "批量";
    } else {
      countEl.classList.add("hidden");
      if (lastSel.type === "overlay") {
        valEl.textContent = `${Math.round(obj.w)}w`;
        editBtn.style.display = "none";
        colorsWrap.style.display = "none";
      } else {
        colorsWrap.style.display = "flex";
        if (lastSel.type === "marker" || lastSel.type === "sticker" || lastSel.type === "arrow" || lastSel.type === "line") {
          valEl.textContent = String(obj.fontSize || (lastSel.type === "line" ? 15 : 18));
          editBtn.style.display = "inline-flex";
        } else {
          valEl.textContent = String(obj.strokeWidth || 1.5);
          editBtn.style.display = "none";
        }
      }
    }

    this.nearToolbar.style.display = "flex";
    const barW = 320;
    const safeX = Number.isFinite(scr.x) ? scr.x : this.viewW / 2;
    const safeY = Number.isFinite(scr.y) ? scr.y : this.viewH / 2;
    const left = Math.max(8, Math.min(Math.max(8, this.viewW - barW - 8), safeX - barW / 2));
    const top = safeY + 74 > this.viewH - 12 ? Math.max(48, safeY - 74) : Math.max(48, safeY + 34);
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

  getPillBoundsImg(ix, iy, text, fontPx = 15, targetScale = this.scale) {
    const fs = fontPx / targetScale;
    this.ctx.save();
    this.ctx.font = `800 ${fs}px sans-serif`;
    const lines = String(text || "").split("\n");
    const maxW = Math.max(...lines.map(l => this.ctx.measureText(l).width), 20 / targetScale);
    this.ctx.restore();
    const padX = 8 / targetScale;
    const padY = 5 / targetScale;
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
    const tol = 26 / this.scale;
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

    this.overlays.forEach((ov, idx) => {
      const im = this.getOverlayImageElement(ov.src);
      if (im && im.complete && im.naturalWidth) {
        ctx.save();
        ctx.drawImage(im, ov.x - ov.w / 2, ov.y - ov.h / 2, ov.w, ov.h);
        const isSel = this.isItemSelected("overlay", idx);
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
      if (this.isItemSelected("path", idx)) {
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
        this.drawPillLabelOnContext(ctx, mx, my, l.text, "#FFFFFF", l.color || "#2563EB", l.fontSize || 15, 0.88, this.scale, false);
      }
      if (this.isItemSelected("line", idx)) {
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

      const isSel = this.isItemSelected("arrow", idx);
      if (a.text) {
        this.drawPillLabelOnContext(ctx, a.x2, a.y2, a.text, col, "#FFFFFF", a.fontSize || 16, 0.78, this.scale, isSel);
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

      if (this.isItemSelected("marker", idx)) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = 2.5 / this.scale;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
      ctx.restore();
    });

    this.stickers.forEach((st, idx) => {
      ctx.save();
      const isSel = this.isItemSelected("sticker", idx);
      this.drawPillLabelOnContext(ctx, st.x, st.y, st.label || "", st.bg || "#DC2626", st.color || "#FFFFFF", st.fontSize || 15, 0.76, this.scale, isSel);
      ctx.restore();
    });

    if (this.marqueeRect) {
      ctx.save();
      ctx.strokeStyle = "#2563EB";
      ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
      ctx.lineWidth = 1.5 / this.scale;
      ctx.setLineDash([5 / this.scale, 4 / this.scale]);
      const rx = Math.min(this.marqueeRect.x1, this.marqueeRect.x2);
      const ry = Math.min(this.marqueeRect.y1, this.marqueeRect.y2);
      const rw = Math.abs(this.marqueeRect.x2 - this.marqueeRect.x1);
      const rh = Math.abs(this.marqueeRect.y2 - this.marqueeRect.y1);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    ctx.restore();
  }

  drawPillLabelOnContext(ctx, ix, iy, text, bg, fg, fontPx = 15, bgAlpha = 0.76, targetScale = this.scale, isSelected = false) {
    const b = this.getPillBoundsImg(ix, iy, text, fontPx, targetScale);
    const fs = fontPx / targetScale;
    const padY = 5 / targetScale;
    const lineH = fs * 1.25;
    const lines = String(text || "").split("\n");

    ctx.save();
    ctx.globalAlpha = bgAlpha;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 6 / targetScale);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSelected ? "#FACC15" : bg;
    ctx.lineWidth = (isSelected ? 2.8 : 1.2) / targetScale;
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
