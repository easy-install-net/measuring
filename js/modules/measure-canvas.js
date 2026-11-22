const STAMP_GROUPS = [
  {
    name: "電掣",
    items: ["13A單蘇", "13A孖蘇", "燈掣", "雙控掣", "數據掣", "電視掣", "冷氣掣", "曲架掣", "電箱"]
  },
  {
    name: "水煤",
    items: ["冷水喉", "熱水喉", "去水位", "地台去水", "煤氣掣", "煤氣錶"]
  },
  {
    name: "收口/結構",
    items: ["收口條", "見光板", "石膏線", "燈槽", "假天花底", "橫樑陣位", "柱位", "暗門", "地腳線"]
  }
];

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, rulerColors, onSave) {
    this.container = container;
    this.imageUrl = imageUrl;

    this.rawInitialData = (initialData && !Array.isArray(initialData) && typeof initialData === "object")
      ? JSON.parse(JSON.stringify(initialData))
      : {};

    if (Array.isArray(initialData)) {
      this.lines = JSON.parse(JSON.stringify(initialData));
      this.markers = [];
      this.paths = [];
      this.walls = [];
      this.stickers = [];
    } else {
      this.lines = JSON.parse(JSON.stringify(initialData?.lines || []));
      this.markers = JSON.parse(JSON.stringify(initialData?.markers || []));
      this.paths = JSON.parse(JSON.stringify(initialData?.paths || initialData?.strokes || []));
      this.walls = JSON.parse(JSON.stringify(initialData?.walls || []));
      this.stickers = this.extractLegacyStickers(initialData);
    }

    const rawColors = (rulerColors && rulerColors.length)
      ? rulerColors.map(c => typeof c === "string" ? c : c.hex)
      : ["#EF4444", "#2563EB", "#16A34A", "#D97706", "#9333EA", "#111827"];
    this.colors = rawColors.filter(Boolean);
    this.activeColor = this.colors[0] || "#EF4444";
    this.onSave = onSave;

    this.tool = "RULER";
    this.activeStamp = "13A孖蘇";

    this.fontFactor = Number(localStorage.getItem("mc_font_factor")) || Number(localStorage.getItem("mc_size_factor")) || 1.0;
    this.lineFactor = Number(localStorage.getItem("mc_line_factor")) || Number(localStorage.getItem("mc_size_factor")) || 1.0;

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.history = [];
    this.redoStack = [];
    this.selectedObj = null;
    this.inlineEditState = null;
    this.stickerCache = new Map();
    this.lastCursorPos = { x: 140, y: 120 };

    this.loadBaseImage(imageUrl, true);
  }

  loadBaseImage(src, isInitial = false) {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      this.img = im;
      this.natW = im.naturalWidth || 1200;
      this.natH = im.naturalHeight || 900;
      if (isInitial) {
        this.normalizeLegacyCoordinates();
        this.preloadStickers();
        this.initUI();
        this.fitToScreen();
      }
      this.render();
    };
    im.onerror = () => {
      // 若伺服器未開放 CORS 標頭，自動回退為一般載入模式確保圖片正常顯示
      if (im.crossOrigin) {
        const fallback = new Image();
        fallback.onload = () => {
          this.img = fallback;
          this.natW = fallback.naturalWidth || 1200;
          this.natH = fallback.naturalHeight || 900;
          if (isInitial) {
            this.normalizeLegacyCoordinates();
            this.preloadStickers();
            this.initUI();
            this.fitToScreen();
          }
          this.render();
        };
        fallback.src = src;
      }
    };
    im.src = src;
  }

  extractLegacyStickers(data) {
    if (!data || typeof data !== "object") return [];
    const knownKeys = ["stickers", "images", "overlays", "attachments", "subImages", "pips", "refs", "photos", "clips"];
    for (const k of knownKeys) {
      if (Array.isArray(data[k]) && data[k].length > 0) {
        this._legacyStickerKey = k;
        return JSON.parse(JSON.stringify(data[k]));
      }
    }
    const ignoreKeys = new Set(["lines", "markers", "paths", "strokes", "walls", "history"]);
    for (const [k, val] of Object.entries(data)) {
      if (ignoreKeys.has(k) || !Array.isArray(val) || val.length === 0) continue;
      const sample = val[0];
      if (sample && typeof sample === "object" && (sample.url || sample.src || sample.imageUrl || sample.dataUrl || sample.img || sample.fileUrl)) {
        this._legacyStickerKey = k;
        return JSON.parse(JSON.stringify(val));
      }
    }
    return [];
  }

  normalizeLegacyCoordinates() {
    const isNorm = (v) => typeof v === "number" && v > 0 && v <= 1.05;

    this.lines.forEach(l => {
      if (isNorm(l.x1) && isNorm(l.y1) && isNorm(l.x2) && isNorm(l.y2)) {
        l.x1 *= this.natW;
        l.y1 *= this.natH;
        l.x2 *= this.natW;
        l.y2 *= this.natH;
      }
      if (Array.isArray(l.chainSegs) && l.chainSegs.length > 1 && !Array.isArray(l.splits)) {
        const n = l.chainSegs.length;
        l.splits = [];
        for (let i = 1; i < n; i++) l.splits.push(i / n);
        l.segValues = l.chainSegs.map(s => String(s.val ?? ""));
      }
    });

    this.markers.forEach(m => {
      if (isNorm(m.x) && isNorm(m.y)) {
        m.x *= this.natW;
        m.y *= this.natH;
      }
    });

    this.paths.forEach(p => {
      const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
      pts.forEach(pt => {
        if (Array.isArray(pt) && isNorm(pt[0]) && isNorm(pt[1])) {
          pt[0] *= this.natW;
          pt[1] *= this.natH;
        } else if (pt && isNorm(pt.x) && isNorm(pt.y)) {
          pt.x *= this.natW;
          pt.y *= this.natH;
        }
      });
    });

    this.walls.forEach(w => {
      if (isNorm(w.x1) && isNorm(w.y1) && isNorm(w.x2) && isNorm(w.y2)) {
        w.x1 *= this.natW;
        w.y1 *= this.natH;
        w.x2 *= this.natW;
        w.y2 *= this.natH;
      }
    });

    this.stickers.forEach(st => {
      if (!st.url) st.url = st.src || st.imageUrl || st.dataUrl || st.img || st.fileUrl || "";
      if (typeof st.x !== "number" && typeof st.left === "number") st.x = st.left;
      if (typeof st.y !== "number" && typeof st.top === "number") st.y = st.top;
      if (typeof st.w !== "number" && typeof st.width === "number") st.w = st.width;
      if (typeof st.h !== "number" && typeof st.height === "number") st.h = st.height;

      if (isNorm(st.x) && isNorm(st.y)) {
        st.x *= this.natW;
        st.y *= this.natH;
      }
      if (isNorm(st.w) && isNorm(st.h)) {
        st.w *= this.natW;
        st.h *= this.natH;
      }
      if (typeof st.x !== "number") st.x = Math.round(this.natW * 0.05);
      if (typeof st.y !== "number") st.y = Math.round(this.natH * 0.05);
      if (!st.w) st.w = Math.round(this.natW * 0.24);
      if (!st.h) st.h = Math.round(this.natH * 0.24);
    });
  }

  preloadStickers() {
    this.stickers.forEach(st => {
      const src = st.url || st.src || st.imageUrl || st.dataUrl || st.img || st.fileUrl;
      if (src && !this.stickerCache.has(src)) {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => this.render();
        im.src = src;
        this.stickerCache.set(src, im);
      }
    });
  }

  pushHistory() {
    this.history.push(JSON.stringify({
      imageUrl: this.imageUrl,
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      walls: this.walls,
      stickers: this.stickers
    }));
    if (this.history.length > 40) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.history.length) return;
    this.commitInlineEditor(false);
    this.redoStack.push(JSON.stringify({
      imageUrl: this.imageUrl,
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      walls: this.walls,
      stickers: this.stickers
    }));
    const prev = JSON.parse(this.history.pop());
    this.lines = prev.lines || [];
    this.markers = prev.markers || [];
    this.paths = prev.paths || [];
    this.walls = prev.walls || [];
    this.stickers = prev.stickers || [];
    this.preloadStickers();
    this.selectedObj = null;
    this.updateFloatingMoveHUD(false);
    if (prev.imageUrl && prev.imageUrl !== this.imageUrl) {
      this.imageUrl = prev.imageUrl;
      this.loadBaseImage(prev.imageUrl, false);
    } else {
      this.render();
    }
    this.triggerSave();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.commitInlineEditor(false);
    this.history.push(JSON.stringify({
      imageUrl: this.imageUrl,
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      walls: this.walls,
      stickers: this.stickers
    }));
    const next = JSON.parse(this.redoStack.pop());
    this.lines = next.lines || [];
    this.markers = next.markers || [];
    this.paths = next.paths || [];
    this.walls = next.walls || [];
    this.stickers = next.stickers || [];
    this.preloadStickers();
    if (next.imageUrl && next.imageUrl !== this.imageUrl) {
      this.imageUrl = next.imageUrl;
      this.loadBaseImage(next.imageUrl, false);
    } else {
      this.render();
    }
    this.triggerSave();
  }

  triggerSave() {
    if (this.onSave) {
      const payload = {
        ...this.rawInitialData,
        lines: this.lines,
        markers: this.markers,
        paths: this.paths,
        walls: this.walls,
        stickers: this.stickers
      };
      if (this.imageUrl) {
        if ("imageUrl" in this.rawInitialData) payload.imageUrl = this.imageUrl;
        if ("url" in this.rawInitialData) payload.url = this.imageUrl;
        if ("imgUrl" in this.rawInitialData) payload.imgUrl = this.imageUrl;
      }
      if (this._legacyStickerKey && this._legacyStickerKey !== "stickers") {
        payload[this._legacyStickerKey] = this.stickers;
      }
      this.onSave(payload);
    }
  }

  initUI() {
    this.container.innerHTML = `
      <div class="mc-wrapper" style="background:#111827; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; user-select:none;">
        <!-- 頂部工具列：全部集中正中對齊 -->
        <div style="display:flex; justify-content:center; align-items:center; padding:6px 12px; background:#1F2937; border-bottom:1px solid #374151; flex-wrap:wrap; gap:14px;">
          <div style="display:flex; align-items:center; gap:6px;">
            ${this.colors.map(c => `
              <button type="button" class="mc-color-btn" data-color="${c}"
                      style="width:20px; height:20px; border-radius:50%; background:${c}; border:${c === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280"}; cursor:pointer;"></button>
            `).join("")}
          </div>

          <div style="width:1px; height:16px; background:#4B5563;"></div>

          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" id="mc-fit" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563; padding:3px 9px; font-size:12px;">重置視角</button>
            <button type="button" id="mc-undo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563; padding:3px 9px; font-size:12px;" title="Ctrl+Z">↩ 復原</button>
            <button type="button" id="mc-redo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563; padding:3px 9px; font-size:12px;" title="Ctrl+Y">↪ 重做</button>
          </div>
        </div>

        <div id="mc-viewport" style="position:relative; width:100%; height:74vh; min-height:440px; background:#0F172A; overflow:hidden; touch-action:none;">
          <canvas id="mc-canvas" style="display:block; width:100%; height:100%;"></canvas>
          <input type="file" id="mc-sticker-input" accept="image/*" class="hidden">

          <!-- 就地直接打字輸入框（零跳窗，直接出現在圖紙位置上） -->
          <input type="text" id="mc-inline-input" class="hidden" autocomplete="off" spellcheck="false"
                 style="position:absolute; transform:translate(-50%, -50%); background:rgba(255,255,255,0.96); border:1.5px dashed #2563EB; border-radius:4px; padding:1px 6px; text-align:center; font-weight:700; outline:none; z-index:25; min-width:54px; box-shadow:0 2px 8px rgba(0,0,0,0.22);" />

          <!-- 左側打直懸浮工具條 -->
          <div id="mc-left-bar" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); display:flex; flex-direction:column; gap:5px; background:rgba(17,24,39,0.88); backdrop-filter:blur(6px); padding:6px 5px; border-radius:12px; border:1px solid rgba(255,255,255,0.16); box-shadow:0 8px 24px rgba(0,0,0,0.45); z-index:15;">
            ${[
              { id: "PAN", icon: "✋", label: "移動" },
              { id: "RULER", icon: "📏", label: "拉尺" },
              { id: "CHAIN", icon: "🔗", label: "分段" },
              { id: "PEN", icon: "✏️", label: "手繪" },
              { id: "STAMP", icon: "🔖", label: "印章" },
              { id: "TEXT", icon: "🔤", label: "文字" },
              { id: "STICKER", icon: "🖼️", label: "貼圖" },
              { id: "ERASER", icon: "🧹", label: "擦除" }
            ].map(t => `
              <button type="button" class="mc-tool-btn" data-tool="${t.id}" title="${t.label}"
                      style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:44px; padding:5px 2px; border-radius:8px; cursor:pointer; border:1px solid ${t.id === this.tool ? "#60A5FA" : "transparent"}; background:${t.id === this.tool ? "#2563EB" : "transparent"}; color:#FFF; transition:all 0.15s;">
                <span style="font-size:15px; line-height:1.1;">${t.icon}</span>
                <span style="font-size:10px; font-weight:700; margin-top:2px; letter-spacing:0.5px;">${t.label}</span>
              </button>
            `).join("")}
          </div>

          <!-- 精緻懸浮印章卡片 -->
          <div id="mc-stamp-drawer" class="hidden" style="position:absolute; left:66px; top:50%; transform:translateY(-50%); width:260px; max-height:70vh; overflow-y:auto; background:rgba(255,255,255,0.96); backdrop-filter:blur(8px); padding:10px; border-radius:12px; border:1.5px solid #CBD5E1; box-shadow:0 12px 30px rgba(0,0,0,0.4); z-index:19; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:4px;">
              <span style="font-size:12px; font-weight:800; color:#1E293B;">🔖 選擇印章（點圖紙蓋章）</span>
              <button type="button" id="mc-stamp-close" style="border:none; background:none; font-size:14px; cursor:pointer; color:#64748B;">✕</button>
            </div>
            ${STAMP_GROUPS.map(g => `
              <div style="display:flex; flex-direction:column; gap:4px;">
                <span style="font-size:11px; font-weight:700; color:#475569;">${g.name}</span>
                <div style="display:flex; flex-wrap:wrap; gap:4px;">
                  ${g.items.map(st => `
                    <button type="button" class="chip mc-stamp-chip ${st === this.activeStamp ? "active" : ""}" data-stamp="${st}" style="font-size:11px; padding:3px 7px;">${st}</button>
                  `).join("")}
                </div>
              </div>
            `).join("")}
          </div>

          <!-- 隨身浮動控制條（含一鍵確定合併貼圖防丟失） -->
          <div id="mc-move-hud" class="hidden" style="position:absolute; left:72px; top:14px; background:rgba(17,24,39,0.95); backdrop-filter:blur(8px); border:1px solid rgba(96,165,250,0.7); border-radius:10px; padding:8px 10px; box-shadow:0 10px 26px rgba(0,0,0,0.5); z-index:18; display:flex; flex-direction:column; gap:7px; width:230px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #374151; padding-bottom:4px;">
              <span id="mc-hud-target" style="font-size:11px; font-weight:700; color:#93C5FD;">✋ 移動調整（全域比例）</span>
              <button type="button" id="mc-hud-del" class="hidden" style="background:#DC2626; color:#FFF; border:none; border-radius:4px; padding:2px 6px; font-size:10px; font-weight:700; cursor:pointer;">🗑️ 刪除</button>
            </div>

            <button type="button" id="mc-hud-merge-sticker" class="hidden" style="background:#059669; color:#FFF; border:none; border-radius:6px; padding:6px 8px; font-size:12px; font-weight:700; cursor:pointer; text-align:center; box-shadow:0 2px 6px rgba(5,150,105,0.4);">
              📌 確定合併進底圖（防丟失）
            </button>

            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:#D1D5DB; min-width:28px;">顏色</span>
              <div style="display:flex; gap:5px; flex-wrap:wrap;">
                ${this.colors.map(c => `
                  <button type="button" class="mc-hud-color" data-color="${c}"
                          style="width:18px; height:18px; border-radius:50%; background:${c}; border:1.5px solid #E5E7EB; cursor:pointer;"></button>
                `).join("")}
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:#D1D5DB; min-width:28px;">文字</span>
              <button type="button" id="mc-font-dec" style="width:22px; height:22px; border-radius:4px; background:#374151; color:#FFF; border:1px solid #4B5563; font-weight:700; cursor:pointer;">-</button>
              <input type="range" id="mc-font-slider" min="0.4" max="2.2" step="0.05" value="${this.fontFactor}" style="flex:1; accent-color:#3B82F6; cursor:pointer;">
              <button type="button" id="mc-font-inc" style="width:22px; height:22px; border-radius:4px; background:#374151; color:#FFF; border:1px solid #4B5563; font-weight:700; cursor:pointer;">+</button>
              <span id="mc-font-val" style="font-size:10px; color:#93C5FD; min-width:30px; text-align:right;">${Math.round(this.fontFactor * 100)}%</span>
            </div>

            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:#D1D5DB; min-width:28px;">線條</span>
              <button type="button" id="mc-line-dec" style="width:22px; height:22px; border-radius:4px; background:#374151; color:#FFF; border:1px solid #4B5563; font-weight:700; cursor:pointer;">-</button>
              <input type="range" id="mc-line-slider" min="0.4" max="2.2" step="0.05" value="${this.lineFactor}" style="flex:1; accent-color:#10B981; cursor:pointer;">
              <button type="button" id="mc-line-inc" style="width:22px; height:22px; border-radius:4px; background:#374151; color:#FFF; border:1px solid #4B5563; font-weight:700; cursor:pointer;">+</button>
              <span id="mc-line-val" style="font-size:10px; color:#6EE7B7; min-width:30px; text-align:right;">${Math.round(this.lineFactor * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.viewport = document.getElementById("mc-viewport");
    this.canvas = document.getElementById("mc-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.inlineInput = document.getElementById("mc-inline-input");

    this.bindToolbarEvents();
    this.bindInlineInputEvents();
    this.bindKeyboardAndPaste();
    this.bindPointerEvents();
    window.addEventListener("resize", () => {
      this.render();
      this.repositionInlineInput();
    });
  }

  // 啟動就地直接打字（支持拉尺數字與文字備註）
  startInlineEdit(state) {
    this.commitInlineEditor(false);
    this.inlineEditState = state;
    const inp = this.inlineInput;
    if (!inp) return;

    inp.value = state.initialValue || "";
    inp.placeholder = state.kind === "line" ? "輸入數字(如 1755-5)" : "輸入文字...";
    inp.inputMode = state.kind === "line" ? "decimal" : "text";
    inp.style.color = state.color || this.activeColor;
    inp.classList.remove("hidden");

    this.repositionInlineInput();
    this.render();
    requestAnimationFrame(() => {
      inp.focus();
      inp.select();
    });
  }

  repositionInlineInput() {
    if (!this.inlineEditState || !this.inlineInput || this.inlineInput.classList.contains("hidden")) return;
    const st = this.inlineEditState;
    let imgX = st.x;
    let imgY = st.y;
    let fScale = this.fontFactor;

    if (st.kind === "line") {
      const l = this.lines[st.lineIdx];
      if (!l) return;
      fScale = l.fontScale || this.fontFactor;
      const splits = Array.isArray(l.splits) ? l.splits : [];
      if (splits.length > 0 && st.segIdx >= 0) {
        const ptsT = [0, ...splits, 1];
        const midT = (ptsT[st.segIdx] + ptsT[st.segIdx + 1]) / 2;
        imgX = l.x1 + (l.x2 - l.x1) * midT;
        imgY = l.y1 + (l.y2 - l.y1) * midT;
      } else {
        imgX = (l.x1 + l.x2) / 2;
        imgY = (l.y1 + l.y2) / 2;
      }
    } else if (st.kind === "marker" && typeof st.markerIdx === "number") {
      const m = this.markers[st.markerIdx];
      if (m) {
        imgX = m.x;
        imgY = m.y;
        fScale = m.fontScale || this.fontFactor;
      }
    }

    const screenX = imgX * this.scale + this.offsetX;
    const screenY = imgY * this.scale + this.offsetY;
    const fontSize = Math.max(13, Math.round((this.natW / 74) * fScale * this.scale));

    this.inlineInput.style.left = `${screenX}px`;
    this.inlineInput.style.top = `${screenY}px`;
    this.inlineInput.style.fontSize = `${fontSize}px`;
    this.inlineInput.style.width = `${Math.max(64, (this.inlineInput.value.length + 2) * fontSize * 0.72)}px`;
  }

  // 安全計算數字或簡易扣減算式（例如 "1755-5" -> 1750）
  evaluateDimensionExpr(raw) {
    const cleaned = String(raw || "").trim().replace(/[^\d.+-]/g, "");
    if (!cleaned) return "";
    if (/^[\d.+-]+$/.test(cleaned)) {
      const tokens = cleaned.match(/[+-]?[\d.]+/g);
      if (tokens) {
        const sum = tokens.reduce((acc, tok) => acc + (parseFloat(tok) || 0), 0);
        return String(Math.round(sum * 100) / 100);
      }
    }
    return cleaned;
  }

  commitInlineEditor(shouldRender = true) {
    if (!this.inlineEditState || !this.inlineInput) return;
    const st = this.inlineEditState;
    const val = this.inlineInput.value.trim();

    this.inlineEditState = null;
    this.inlineInput.classList.add("hidden");

    if (st.kind === "line") {
      const l = this.lines[st.lineIdx];
      if (l) {
        const computed = this.evaluateDimensionExpr(val);
        this.pushHistory();
        if (Array.isArray(l.splits) && l.splits.length > 0 && st.segIdx >= 0) {
          if (!Array.isArray(l.segValues)) l.segValues = Array(l.splits.length + 1).fill("");
          l.segValues[st.segIdx] = computed;
          const total = l.segValues.reduce((s, v) => s + (Number(v) || 0), 0);
          l.text = total > 0 ? String(total) : "";
        } else {
          l.text = computed;
        }
        this.triggerSave();
      }
    } else if (st.kind === "marker") {
      if (typeof st.markerIdx === "number" && this.markers[st.markerIdx]) {
        if (val) {
          this.pushHistory();
          this.markers[st.markerIdx].text = val;
          this.triggerSave();
        }
      } else if (val) {
        this.pushHistory();
        this.markers.push({
          x: st.x,
          y: st.y,
          text: val,
          color: st.color || this.activeColor,
          isStamp: false
        });
        this.triggerSave();
      }
    }

    if (shouldRender) this.render();
  }

  cancelInlineEditor() {
    this.inlineEditState = null;
    if (this.inlineInput) this.inlineInput.classList.add("hidden");
    this.render();
  }

  bindInlineInputEvents() {
    if (!this.inlineInput) return;
    this.inlineInput.addEventListener("input", () => {
      const fs = parseFloat(this.inlineInput.style.fontSize) || 15;
      this.inlineInput.style.width = `${Math.max(64, (this.inlineInput.value.length + 2) * fs * 0.72)}px`;
    });
    this.inlineInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitInlineEditor(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelInlineEditor();
      }
    });
    this.inlineInput.addEventListener("blur", () => {
      if (this.inlineEditState) this.commitInlineEditor(true);
    });
  }

  // 一鍵將選中的貼圖燒錄合併進底圖，徹底防丟失
  mergeSelectedStickerIntoBase() {
    if (!this.selectedObj || this.selectedObj.type !== "sticker") return;
    const idx = this.selectedObj.idx;
    const st = this.stickers[idx];
    if (!st || !this.img) return;

    const src = st.url || st.src || st.imageUrl || st.dataUrl || st.img || st.fileUrl;
    const stImg = src ? this.stickerCache.get(src) : null;
    if (!stImg || !stImg.complete) {
      alert("貼圖仍在載入中，請稍候一秒再按合併。");
      return;
    }

    try {
      const off = document.createElement("canvas");
      off.width = this.natW;
      off.height = this.natH;
      const octx = off.getContext("2d");
      octx.drawImage(this.img, 0, 0, this.natW, this.natH);
      octx.drawImage(stImg, st.x, st.y, st.w, st.h);

      let mergedDataUrl = "";
      try {
        mergedDataUrl = off.toDataURL("image/jpeg", 0.92);
      } catch (corsErr) {
        alert("無法直接合併雲端原底圖（伺服器跨網域 CORS 限制）。建議先下載或截圖後作為新底圖上傳。");
        return;
      }

      this.pushHistory();
      this.stickers.splice(idx, 1);
      this.selectedObj = null;
      this.imageUrl = mergedDataUrl;
      this.updateFloatingMoveHUD(false);
      this.loadBaseImage(mergedDataUrl, false);
      this.triggerSave();
    } catch (err) {
      console.error("合併貼圖失敗:", err);
    }
  }

  positionMoveHUD(viewportX, viewportY) {
    const hud = document.getElementById("mc-move-hud");
    if (!hud || !this.viewport) return;
    const vw = this.viewport.clientWidth || 600;
    const vh = this.viewport.clientHeight || 440;
    const bw = 230;
    const bh = hud.offsetHeight || 150;

    let left = viewportX + 16;
    let top = viewportY + 16;
    if (left + bw > vw - 10) left = Math.max(66, viewportX - bw - 16);
    if (left < 66) left = 66;
    if (top + bh > vh - 10) top = Math.max(10, viewportY - bh - 16);
    if (top < 10) top = 10;

    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }

  updateFloatingMoveHUD(moveNearCursor = false) {
    const hud = document.getElementById("mc-move-hud");
    if (!hud) return;

    if (this.tool !== "PAN") {
      hud.classList.add("hidden");
      return;
    }

    hud.classList.remove("hidden");
    const targetLabel = document.getElementById("mc-hud-target");
    const delBtn = document.getElementById("mc-hud-del");
    const mergeBtn = document.getElementById("mc-hud-merge-sticker");
    const fontSlider = document.getElementById("mc-font-slider");
    const lineSlider = document.getElementById("mc-line-slider");
    const fontVal = document.getElementById("mc-font-val");
    const lineVal = document.getElementById("mc-line-val");

    let curFont = this.fontFactor;
    let curLine = this.lineFactor;
    mergeBtn.classList.add("hidden");

    if (this.selectedObj) {
      delBtn.classList.remove("hidden");
      const { type, idx } = this.selectedObj;
      if (type === "line" && this.lines[idx]) {
        targetLabel.textContent = "📏 單獨調整選中拉尺";
        curFont = this.lines[idx].fontScale || this.fontFactor;
        curLine = this.lines[idx].lineScale || this.lineFactor;
      } else if (type === "marker" && this.markers[idx]) {
        targetLabel.textContent = "🔤 單獨調整選中文字/印章";
        curFont = this.markers[idx].fontScale || this.fontFactor;
      } else if (type === "path" && this.paths[idx]) {
        targetLabel.textContent = "✏️ 單獨調整選中筆跡";
        curLine = this.paths[idx].lineScale || this.lineFactor;
      } else if (type === "sticker") {
        targetLabel.textContent = "🖼️ 已選中貼圖（拖右下角縮放）";
        mergeBtn.classList.remove("hidden");
      }
    } else {
      delBtn.classList.add("hidden");
      targetLabel.textContent = "✋ 移動調整（全域比例）";
    }

    fontSlider.value = curFont;
    lineSlider.value = curLine;
    fontVal.textContent = `${Math.round(curFont * 100)}%`;
    lineVal.textContent = `${Math.round(curLine * 100)}%`;

    if (moveNearCursor) {
      this.positionMoveHUD(this.lastCursorPos.x, this.lastCursorPos.y);
    }
  }

  applyFontFactorChange(nextVal, recordHistory = false) {
    const clamped = Math.max(0.4, Math.min(2.2, Number(nextVal.toFixed(2))));
    if (this.selectedObj) {
      const { type, idx } = this.selectedObj;
      if (type === "line" && this.lines[idx]) {
        if (recordHistory) this.pushHistory();
        this.lines[idx].fontScale = clamped;
        this.triggerSave();
      } else if (type === "marker" && this.markers[idx]) {
        if (recordHistory) this.pushHistory();
        this.markers[idx].fontScale = clamped;
        this.triggerSave();
      }
    } else {
      this.fontFactor = clamped;
      localStorage.setItem("mc_font_factor", String(clamped));
    }
    this.updateFloatingMoveHUD(false);
    this.render();
  }

  applyLineFactorChange(nextVal, recordHistory = false) {
    const clamped = Math.max(0.4, Math.min(2.2, Number(nextVal.toFixed(2))));
    if (this.selectedObj) {
      const { type, idx } = this.selectedObj;
      if (type === "line" && this.lines[idx]) {
        if (recordHistory) this.pushHistory();
        this.lines[idx].lineScale = clamped;
        this.triggerSave();
      } else if (type === "path" && this.paths[idx]) {
        if (recordHistory) this.pushHistory();
        this.paths[idx].lineScale = clamped;
        this.triggerSave();
      }
    } else {
      this.lineFactor = clamped;
      localStorage.setItem("mc_line_factor", String(clamped));
    }
    this.updateFloatingMoveHUD(false);
    this.render();
  }

  applyColorChange(newColor) {
    this.activeColor = newColor;
    this.container.querySelectorAll(".mc-color-btn").forEach(b => {
      b.style.border = b.dataset.color === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280";
    });
    if (this.selectedObj) {
      const { type, idx } = this.selectedObj;
      this.pushHistory();
      if (type === "line" && this.lines[idx]) this.lines[idx].color = newColor;
      if (type === "marker" && this.markers[idx]) this.markers[idx].color = newColor;
      if (type === "path" && this.paths[idx]) this.paths[idx].color = newColor;
      this.triggerSave();
    }
    this.render();
  }

  bindKeyboardAndPaste() {
    if (this._keyHandler) window.removeEventListener("keydown", this._keyHandler);
    this._keyHandler = (e) => {
      if (!document.body.contains(this.canvas)) return;
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && this.selectedObj) {
        e.preventDefault();
        this.deleteSelected();
      } else if (e.key === "Escape") {
        this.selectedObj = null;
        this.cancelInlineEditor();
        document.getElementById("mc-stamp-drawer")?.classList.add("hidden");
        this.updateFloatingMoveHUD(false);
        this.render();
      }
    };
    window.addEventListener("keydown", this._keyHandler);

    if (this._pasteHandler) window.removeEventListener("paste", this._pasteHandler);
    this._pasteHandler = (e) => {
      if (!document.body.contains(this.canvas)) return;
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) this.addStickerFromFile(file);
        }
      }
    };
    window.addEventListener("paste", this._pasteHandler);
  }

  deleteSelected() {
    if (!this.selectedObj) return;
    this.pushHistory();
    const { type, idx } = this.selectedObj;
    if (type === "line") this.lines.splice(idx, 1);
    else if (type === "marker") this.markers.splice(idx, 1);
    else if (type === "path") this.paths.splice(idx, 1);
    else if (type === "sticker") this.stickers.splice(idx, 1);
    this.selectedObj = null;
    this.updateFloatingMoveHUD(false);
    this.render();
    this.triggerSave();
  }

  addStickerFromFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const tmp = new Image();
      tmp.onload = () => {
        const maxW = this.natW * 0.28;
        const ratio = tmp.height / (tmp.width || 1);
        const w = Math.min(tmp.width, maxW);
        const h = w * ratio;
        this.pushHistory();
        const cx = (-this.offsetX + this.viewport.clientWidth / 2) / this.scale;
        const cy = (-this.offsetY + this.viewport.clientHeight / 2) / this.scale;
        this.stickers.push({
          x: cx - w / 2,
          y: cy - h / 2,
          w,
          h,
          url: dataUrl
        });
        this.stickerCache.set(dataUrl, tmp);
        this.selectedObj = { type: "sticker", idx: this.stickers.length - 1, part: "body" };
        this.setActiveTool("PAN", true);
        this.render();
        this.triggerSave();
      };
      tmp.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  setActiveTool(toolId, moveHudNearCursor = false) {
    this.commitInlineEditor(false);
    this.tool = toolId;
    this.container.querySelectorAll(".mc-tool-btn").forEach(b => {
      const active = b.dataset.tool === this.tool;
      b.style.background = active ? "#2563EB" : "transparent";
      b.style.borderColor = active ? "#60A5FA" : "transparent";
    });
    const drawer = document.getElementById("mc-stamp-drawer");
    if (drawer) {
      if (this.tool === "STAMP") drawer.classList.remove("hidden");
      else drawer.classList.add("hidden");
    }
    this.updateFloatingMoveHUD(moveHudNearCursor);
  }

  bindToolbarEvents() {
    this.container.querySelectorAll(".mc-color-btn, .mc-hud-color").forEach(btn => {
      btn.onclick = () => this.applyColorChange(btn.dataset.color);
    });

    const fontSlider = document.getElementById("mc-font-slider");
    fontSlider.oninput = () => this.applyFontFactorChange(Number(fontSlider.value), false);
    fontSlider.onchange = () => { if (this.selectedObj) this.triggerSave(); };
    document.getElementById("mc-font-dec").onclick = () => this.applyFontFactorChange(Number(fontSlider.value) - 0.1, true);
    document.getElementById("mc-font-inc").onclick = () => this.applyFontFactorChange(Number(fontSlider.value) + 0.1, true);

    const lineSlider = document.getElementById("mc-line-slider");
    lineSlider.oninput = () => this.applyLineFactorChange(Number(lineSlider.value), false);
    lineSlider.onchange = () => { if (this.selectedObj) this.triggerSave(); };
    document.getElementById("mc-line-dec").onclick = () => this.applyLineFactorChange(Number(lineSlider.value) - 0.1, true);
    document.getElementById("mc-line-inc").onclick = () => this.applyLineFactorChange(Number(lineSlider.value) + 0.1, true);

    document.getElementById("mc-hud-del").onclick = () => this.deleteSelected();
    document.getElementById("mc-hud-merge-sticker").onclick = () => this.mergeSelectedStickerIntoBase();

    const stickerInput = document.getElementById("mc-sticker-input");
    stickerInput.onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) this.addStickerFromFile(f);
      stickerInput.value = "";
    };

    this.container.querySelectorAll(".mc-tool-btn").forEach(btn => {
      btn.onclick = () => {
        const nextTool = btn.dataset.tool;
        if (nextTool === "STICKER") {
          stickerInput.click();
          return;
        }
        if (nextTool === "STAMP") {
          const drawer = document.getElementById("mc-stamp-drawer");
          if (this.tool === "STAMP" && drawer) {
            drawer.classList.toggle("hidden");
            return;
          }
        }
        this.setActiveTool(nextTool, nextTool === "PAN");
      };
    });

    document.getElementById("mc-stamp-close").onclick = () => {
      document.getElementById("mc-stamp-drawer")?.classList.add("hidden");
    };

    this.container.querySelectorAll(".mc-stamp-chip").forEach(btn => {
      btn.onclick = () => {
        this.activeStamp = btn.dataset.stamp;
        this.container.querySelectorAll(".mc-stamp-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("mc-stamp-drawer")?.classList.add("hidden");
      };
    });

    document.getElementById("mc-fit").onclick = () => { this.fitToScreen(); this.render(); this.repositionInlineInput(); };
    document.getElementById("mc-undo").onclick = () => this.undo();
    document.getElementById("mc-redo").onclick = () => this.redo();
  }

  openInlineLineEditor(lineIdx, segIdx = 0) {
    const line = this.lines[lineIdx];
    if (!line) return;
    this.selectedObj = { type: "line", idx: lineIdx, part: "body" };
    this.updateFloatingMoveHUD(false);

    const hasSplits = Array.isArray(line.splits) && line.splits.length > 0;
    let initVal = "";
    if (hasSplits) {
      const segCount = line.splits.length + 1;
      if (!Array.isArray(line.segValues)) line.segValues = Array(segCount).fill("");
      while (line.segValues.length < segCount) line.segValues.push("");
      initVal = String(line.segValues[segIdx] || "");
    } else {
      initVal = String(line.text || line.label || "").replace(/[^\d.]/g, "");
    }

    this.startInlineEdit({
      kind: "line",
      lineIdx,
      segIdx: hasSplits ? segIdx : -1,
      initialValue: initVal,
      color: line.color || this.activeColor
    });
  }

  fitToScreen() {
    const rect = this.viewport.getBoundingClientRect();
    const vw = rect.width || 800;
    const vh = rect.height || 500;
    this.scale = Math.min(vw / this.natW, vh / this.natH) * 0.96;
    this.offsetX = (vw - this.natW * this.scale) / 2;
    this.offsetY = (vh - this.natH * this.scale) / 2;
  }

  screenToImg(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale
    };
  }

  projectToSegment(pt, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { t: 0, dist: Math.hypot(pt.x - x1, pt.y - y1) };
    const t = Math.max(0, Math.min(1, ((pt.x - x1) * dx + (pt.y - y1) * dy) / len2));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    return { t, dist: Math.hypot(pt.x - px, pt.y - py) };
  }

  hitTestObject(pt) {
    const tol = 18 / this.scale;

    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i];
      if (Math.hypot(pt.x - (s.x + s.w), pt.y - (s.y + s.h)) < tol * 1.3) {
        return { type: "sticker", idx: i, part: "resize" };
      }
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) {
        return { type: "sticker", idx: i, part: "body" };
      }
    }

    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      if (Math.hypot(pt.x - m.x, pt.y - m.y) < tol * 1.6) {
        return { type: "marker", idx: i, part: "body" };
      }
    }

    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (Math.hypot(pt.x - l.x1, pt.y - l.y1) < tol * 1.2) {
        return { type: "line", idx: i, part: "p1" };
      }
      if (Math.hypot(pt.x - l.x2, pt.y - l.y2) < tol * 1.2) {
        return { type: "line", idx: i, part: "p2" };
      }
      const proj = this.projectToSegment(pt, l.x1, l.y1, l.x2, l.y2);
      if (proj.dist < tol) {
        return { type: "line", idx: i, part: "body", t: proj.t };
      }
    }

    for (let i = this.paths.length - 1; i >= 0; i--) {
      const p = this.paths[i];
      const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
      for (const node of pts) {
        const nx = Array.isArray(node) ? node[0] : node.x;
        const ny = Array.isArray(node) ? node[1] : node.y;
        if (Math.hypot(pt.x - nx, pt.y - ny) < tol) {
          return { type: "path", idx: i, part: "body" };
        }
      }
    }

    return null;
  }

  bindPointerEvents() {
    let isDown = false;
    let startPt = null;
    let lastPt = null;
    let draftLine = null;
    let draftPath = null;
    let panStart = null;
    let hasMoved = false;
    let historyPushedForDrag = false;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    const activePointers = new Map();

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.commitInlineEditor(false);
      const rect = this.viewport.getBoundingClientRect();
      this.lastCursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      const hit = this.hitTestObject(imgPt);
      if (hit) this.selectedObj = hit;
      this.setActiveTool("PAN", true);
      this.render();
    });

    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 2) return;
      if (this.inlineEditState) {
        this.commitInlineEditor(true);
        return;
      }

      const rect = this.viewport.getBoundingClientRect();
      this.lastCursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      this.canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartScale = this.scale;
        draftLine = null;
        draftPath = null;
        return;
      }

      isDown = true;
      hasMoved = false;
      historyPushedForDrag = false;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      startPt = imgPt;
      lastPt = imgPt;

      if (this.tool === "PAN") {
        const hit = this.hitTestObject(imgPt);
        this.selectedObj = hit;
        if (hit) {
          this.updateFloatingMoveHUD(true);
        } else {
          panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
          this.updateFloatingMoveHUD(false);
        }
        this.render();
      } else if (this.tool === "RULER" || this.tool === "CHAIN") {
        const hit = this.hitTestObject(imgPt);
        if (hit && hit.type === "line" && hit.part === "body") {
          isDown = false;
          this.handleLineClickAction(hit.idx, hit.t);
          return;
        }
        draftLine = {
          x1: imgPt.x,
          y1: imgPt.y,
          x2: imgPt.x,
          y2: imgPt.y,
          color: this.activeColor,
          text: "",
          splits: this.tool === "CHAIN" ? [0.5] : [],
          segValues: this.tool === "CHAIN" ? ["", ""] : []
        };
      } else if (this.tool === "PEN") {
        draftPath = {
          color: this.activeColor,
          points: [{ x: imgPt.x, y: imgPt.y }]
        };
      } else if (this.tool === "STAMP") {
        this.pushHistory();
        this.markers.push({
          x: imgPt.x,
          y: imgPt.y,
          text: this.activeStamp,
          color: this.activeColor,
          isStamp: true
        });
        this.render();
        this.triggerSave();
      } else if (this.tool === "TEXT") {
        isDown = false;
        this.startInlineEdit({
          kind: "marker",
          x: imgPt.x,
          y: imgPt.y,
          initialValue: "",
          color: this.activeColor
        });
      } else if (this.tool === "ERASER") {
        this.eraseAt(imgPt);
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
      const rect = this.viewport.getBoundingClientRect();
      this.lastCursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStartDist > 0) {
          const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
          const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
          const nextScale = Math.max(0.15, Math.min(8, pinchStartScale * (dist / pinchStartDist)));
          this.offsetX = midX - (midX - this.offsetX) * (nextScale / this.scale);
          this.offsetY = midY - (midY - this.offsetY) * (nextScale / this.scale);
          this.scale = nextScale;
          this.render();
          this.repositionInlineInput();
        }
        return;
      }

      if (!isDown) return;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      const dx = imgPt.x - lastPt.x;
      const dy = imgPt.y - lastPt.y;
      if (Math.hypot(imgPt.x - startPt.x, imgPt.y - startPt.y) > 3 / this.scale) {
        hasMoved = true;
      }

      if (this.tool === "PAN") {
        if (this.selectedObj && hasMoved) {
          if (!historyPushedForDrag) {
            this.pushHistory();
            historyPushedForDrag = true;
          }
          this.moveSelectedObject(dx, dy, imgPt);
          this.positionMoveHUD(this.lastCursorPos.x, this.lastCursorPos.y);
          this.render();
        } else if (panStart) {
          this.offsetX = e.clientX - panStart.x;
          this.offsetY = e.clientY - panStart.y;
          this.render();
          this.repositionInlineInput();
        }
      } else if (draftLine) {
        const totalDx = imgPt.x - startPt.x;
        const totalDy = imgPt.y - startPt.y;
        if (Math.abs(totalDy) < Math.abs(totalDx) * 0.06) {
          draftLine.x2 = imgPt.x;
          draftLine.y2 = startPt.y;
        } else if (Math.abs(totalDx) < Math.abs(totalDy) * 0.06) {
          draftLine.x2 = startPt.x;
          draftLine.y2 = imgPt.y;
        } else {
          draftLine.x2 = imgPt.x;
          draftLine.y2 = imgPt.y;
        }
        this.render(draftLine, null);
      } else if (draftPath) {
        draftPath.points.push({ x: imgPt.x, y: imgPt.y });
        this.render(null, draftPath);
      } else if (this.tool === "ERASER") {
        this.eraseAt(imgPt);
      }

      lastPt = imgPt;
    });

    const endPointer = (e) => {
      activePointers.delete(e.pointerId);

      if (this.tool === "PAN" && isDown && !hasMoved && this.selectedObj) {
        const { type, idx } = this.selectedObj;
        if (type === "line") {
          const proj = this.projectToSegment(startPt, this.lines[idx].x1, this.lines[idx].y1, this.lines[idx].x2, this.lines[idx].y2);
          this.handleLineClickAction(idx, proj.t);
        } else if (type === "marker") {
          const m = this.markers[idx];
          this.startInlineEdit({
            kind: "marker",
            markerIdx: idx,
            x: m.x,
            y: m.y,
            initialValue: m.text || "",
            color: m.color || this.activeColor
          });
        }
      }

      if (historyPushedForDrag) {
        this.triggerSave();
      }

      if (draftLine) {
        const len = Math.hypot(draftLine.x2 - draftLine.x1, draftLine.y2 - draftLine.y1);
        if (len > 15 / this.scale) {
          this.pushHistory();
          this.lines.push(draftLine);
          const newIdx = this.lines.length - 1;
          this.render();
          this.triggerSave();
          this.openInlineLineEditor(newIdx, 0);
        } else {
          this.render();
        }
        draftLine = null;
      }

      if (draftPath) {
        if (draftPath.points.length > 1) {
          this.pushHistory();
          this.paths.push(draftPath);
          this.render();
          this.triggerSave();
        }
        draftPath = null;
      }

      isDown = false;
      panStart = null;
    };

    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextScale = Math.max(0.15, Math.min(8, this.scale * factor));
      this.offsetX = mx - (mx - this.offsetX) * (nextScale / this.scale);
      this.offsetY = my - (my - this.offsetY) * (nextScale / this.scale);
      this.scale = nextScale;
      this.render();
      this.repositionInlineInput();
    }, { passive: false });
  }

  handleLineClickAction(lineIdx, t) {
    const line = this.lines[lineIdx];
    if (!line) return;
    if (!Array.isArray(line.splits)) line.splits = [];
    if (!Array.isArray(line.segValues)) line.segValues = [];

    if (this.tool === "CHAIN" && t > 0.06 && t < 0.94) {
      const nearSplitIdx = line.splits.findIndex(sp => Math.abs(sp - t) < 0.04);
      this.pushHistory();
      if (nearSplitIdx !== -1) {
        line.splits.splice(nearSplitIdx, 1);
        line.segValues.splice(nearSplitIdx, 1);
      } else {
        if (line.splits.length === 0 && line.text) {
          line.segValues = [String(line.text), ""];
        }
        line.splits.push(t);
        line.splits.sort((a, b) => a - b);
        const insertedIdx = line.splits.indexOf(t);
        line.segValues.splice(insertedIdx + 1, 0, "");
      }
      const total = line.segValues.reduce((s, v) => s + (Number(v) || 0), 0);
      if (line.splits.length > 0) line.text = total > 0 ? String(total) : "";
      this.render();
      this.triggerSave();
      const targetSeg = Math.max(0, line.splits.findIndex(sp => t <= sp));
      this.openInlineLineEditor(lineIdx, targetSeg === -1 ? line.splits.length : targetSeg);
      return;
    }

    if (line.splits.length > 0) {
      let segIdx = line.splits.findIndex(sp => t <= sp);
      if (segIdx === -1) segIdx = line.splits.length;
      this.openInlineLineEditor(lineIdx, segIdx);
    } else {
      this.openInlineLineEditor(lineIdx, 0);
    }
  }

  moveSelectedObject(dx, dy, imgPt) {
    if (!this.selectedObj) return;
    const { type, idx, part } = this.selectedObj;

    if (type === "line" && this.lines[idx]) {
      const l = this.lines[idx];
      if (part === "p1") {
        l.x1 = imgPt.x;
        l.y1 = imgPt.y;
      } else if (part === "p2") {
        l.x2 = imgPt.x;
        l.y2 = imgPt.y;
      } else {
        l.x1 += dx; l.y1 += dy;
        l.x2 += dx; l.y2 += dy;
      }
    } else if (type === "marker" && this.markers[idx]) {
      this.markers[idx].x += dx;
      this.markers[idx].y += dy;
    } else if (type === "sticker" && this.stickers[idx]) {
      const s = this.stickers[idx];
      if (part === "resize") {
        s.w = Math.max(30, imgPt.x - s.x);
        s.h = Math.max(30, imgPt.y - s.y);
      } else {
        s.x += dx;
        s.y += dy;
      }
    } else if (type === "path" && this.paths[idx]) {
      const p = this.paths[idx];
      const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
      pts.forEach(node => {
        if (Array.isArray(node)) { node[0] += dx; node[1] += dy; }
        else { node.x += dx; node.y += dy; }
      });
    }
  }

  eraseAt(pt) {
    const hit = this.hitTestObject(pt);
    if (!hit) return;
    this.pushHistory();
    if (hit.type === "sticker") this.stickers.splice(hit.idx, 1);
    else if (hit.type === "marker") this.markers.splice(hit.idx, 1);
    else if (hit.type === "line") this.lines.splice(hit.idx, 1);
    else if (hit.type === "path") this.paths.splice(hit.idx, 1);
    if (this.selectedObj?.type === hit.type && this.selectedObj?.idx === hit.idx) {
      this.selectedObj = null;
      this.updateFloatingMoveHUD(false);
    }
    this.render();
    this.triggerSave();
  }

  render(draftLine = null, draftPath = null) {
    if (!this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.viewport.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    ctx.drawImage(this.img, 0, 0, this.natW, this.natH);

    this.stickers.forEach((st, idx) => {
      const isSel = this.selectedObj?.type === "sticker" && this.selectedObj?.idx === idx;
      this.drawSticker(ctx, st, isSel);
    });

    const allPaths = draftPath ? [...this.paths, draftPath] : this.paths;
    allPaths.forEach((p, idx) => {
      const isSel = this.selectedObj?.type === "path" && this.selectedObj?.idx === idx;
      this.drawFreehandPath(ctx, p, isSel);
    });

    this.walls.forEach(w => {
      ctx.save();
      ctx.strokeStyle = w.color || "#111827";
      ctx.lineWidth = Math.max(2, (this.natW / 450) * this.lineFactor);
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
      ctx.restore();
    });

    const allLines = draftLine ? [...this.lines, draftLine] : this.lines;
    allLines.forEach((l, idx) => {
      const isSel = this.selectedObj?.type === "line" && this.selectedObj?.idx === idx;
      this.drawRulerLine(ctx, l, isSel, idx);
    });

    this.markers.forEach((m, idx) => {
      if (this.inlineEditState?.kind === "marker" && this.inlineEditState?.markerIdx === idx) return;
      const isSel = this.selectedObj?.type === "marker" && this.selectedObj?.idx === idx;
      this.drawMarker(ctx, m, isSel);
    });

    ctx.restore();
  }

  drawSticker(ctx, st, isSelected) {
    const src = st.url || st.src || st.imageUrl || st.dataUrl || st.img || st.fileUrl;
    const im = src ? this.stickerCache.get(src) : null;
    ctx.save();
    if (im && im.complete && im.naturalWidth > 0) {
      ctx.drawImage(im, st.x, st.y, st.w, st.h);
    } else {
      ctx.fillStyle = "rgba(241,245,249,0.85)";
      ctx.fillRect(st.x, st.y, st.w, st.h);
    }
    if (isSelected) {
      ctx.strokeStyle = "#2563EB";
      ctx.lineWidth = 2 / this.scale;
      ctx.setLineDash([5 / this.scale, 3 / this.scale]);
      ctx.strokeRect(st.x, st.y, st.w, st.h);
      ctx.setLineDash([]);
      const hs = 9 / this.scale;
      ctx.fillStyle = "#2563EB";
      ctx.fillRect(st.x + st.w - hs / 2, st.y + st.h - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  drawFreehandPath(ctx, p, isSelected) {
    const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
    if (pts.length < 2) return;
    const lScale = p.lineScale || this.lineFactor;
    ctx.save();
    ctx.strokeStyle = isSelected ? "#F59E0B" : (p.color || "#111827");
    ctx.lineWidth = Math.max(1.3, (this.natW / 650) * lScale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((node, i) => {
      const x = Array.isArray(node) ? node[0] : node.x;
      const y = Array.isArray(node) ? node[1] : node.y;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  drawTightText(ctx, text, x, y, fontSize, textColor, isFilledBg = false) {
    ctx.save();
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const metrics = ctx.measureText(text);
    const padX = Math.max(2, fontSize * 0.16);
    const padY = Math.max(1, fontSize * 0.08);
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize + padY * 2;

    ctx.fillStyle = isFilledBg ? textColor : "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH);

    ctx.fillStyle = isFilledBg ? "#FFFFFF" : textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  drawRulerLine(ctx, l, isSelected, lineIdx = -1) {
    const color = l.color || "#2563EB";
    const lScale = l.lineScale || this.lineFactor;
    const fScale = l.fontScale || this.fontFactor;
    const lw = Math.max(1.2, (this.natW / 760) * lScale);
    const headLen = lw * 3.1;
    const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
    const fontSize = Math.max(10, Math.round((this.natW / 74) * fScale));
    const isEditingThisLine = this.inlineEditState?.kind === "line" && this.inlineEditState?.lineIdx === lineIdx;

    ctx.save();
    ctx.strokeStyle = isSelected ? "#F59E0B" : color;
    ctx.lineWidth = lw;

    if (l.dashed || l.style === "dashed") {
      ctx.setLineDash([lw * 3, lw * 2]);
    }

    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawEnd = (x, y, ang) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + headLen * Math.cos(ang + 0.38), y + headLen * Math.sin(ang + 0.38));
      ctx.moveTo(x, y);
      ctx.lineTo(x + headLen * Math.cos(ang - 0.38), y + headLen * Math.sin(ang - 0.38));
      ctx.stroke();
    };
    drawEnd(l.x1, l.y1, angle);
    drawEnd(l.x2, l.y2, angle + Math.PI);

    if (isSelected) {
      const r = 4.5 / this.scale;
      ctx.fillStyle = "#F59E0B";
      ctx.beginPath(); ctx.arc(l.x1, l.y1, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(l.x2, l.y2, r, 0, Math.PI * 2); ctx.fill();
    }

    const splits = Array.isArray(l.splits) ? l.splits : [];
    if (splits.length > 0) {
      const tickLen = headLen * 0.95;
      splits.forEach(t => {
        const sx = l.x1 + (l.x2 - l.x1) * t;
        const sy = l.y1 + (l.y2 - l.y1) * t;
        ctx.beginPath();
        ctx.moveTo(sx - tickLen * Math.cos(angle + Math.PI / 3), sy - tickLen * Math.sin(angle + Math.PI / 3));
        ctx.lineTo(sx + tickLen * Math.cos(angle + Math.PI / 3), sy + tickLen * Math.sin(angle + Math.PI / 3));
        ctx.stroke();
      });

      const ptsT = [0, ...splits, 1];
      const segVals = Array.isArray(l.segValues) ? l.segValues : [];
      let total = 0;
      for (let i = 0; i < ptsT.length - 1; i++) {
        total += Number(segVals[i]) || 0;
        if (isEditingThisLine && this.inlineEditState?.segIdx === i) continue;
        const midT = (ptsT[i] + ptsT[i + 1]) / 2;
        const mx = l.x1 + (l.x2 - l.x1) * midT;
        const my = l.y1 + (l.y2 - l.y1) * midT;
        const vStr = segVals[i] ? String(segVals[i]) : "·";
        this.drawTightText(ctx, vStr, mx, my, fontSize, color, false);
      }

      if (total > 0) {
        const cx = (l.x1 + l.x2) / 2;
        const cy = (l.y1 + l.y2) / 2;
        const perpX = Math.sin(angle) * (fontSize * 1.15);
        const perpY = -Math.cos(angle) * (fontSize * 1.15);
        this.drawTightText(ctx, `總:${total}`, cx + perpX, cy + perpY, Math.max(10, Math.round(fontSize * 0.92)), color, false);
      }
    } else if (!isEditingThisLine) {
      const label = l.text ? String(l.text) : (l.label ? String(l.label) : "");
      if (label) {
        const mx = (l.x1 + l.x2) / 2;
        const my = (l.y1 + l.y2) / 2;
        this.drawTightText(ctx, label, mx, my, fontSize, color, false);
      }
    }

    ctx.restore();
  }

  drawMarker(ctx, m, isSelected) {
    const text = m.text || m.label || m.val || "";
    if (!text) return;
    const color = isSelected ? "#F59E0B" : (m.color || "#2563EB");
    const fScale = m.fontScale || this.fontFactor;
    const fontSize = Math.max(10, Math.round((this.natW / 74) * fScale));
    const isFilledStamp = m.isStamp === true;
    this.drawTightText(ctx, text, m.x, m.y, fontSize, color, isFilledStamp);
  }
}
