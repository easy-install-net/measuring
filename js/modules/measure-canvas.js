const STAMP_GROUPS = [
  { name: "電掣", items: ["13A單蘇", "13A孖蘇", "燈掣", "雙控掣", "數據掣", "電視掣", "冷氣掣", "曲架掣", "電箱"] },
  { name: "水煤", items: ["冷水喉", "熱水喉", "去水位", "地台去水", "煤氣掣", "煤氣錶"] },
  { name: "收口/結構", items: ["收口條", "見光板", "石膏線", "燈槽", "假天花底", "橫樑陣位", "柱位", "暗門", "地腳線"] }
];

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, rulerColors, onSave) {
    this.container = container;
    this.imageUrl = imageUrl;

    if (Array.isArray(initialData)) {
      this.lines = JSON.parse(JSON.stringify(initialData));
      this.markers = [];
      this.paths = [];
      this.walls = [];
      this.stickers = [];
    } else {
      this.lines = JSON.parse(JSON.stringify(initialData?.lines || []));
      this.markers = JSON.parse(JSON.stringify(initialData?.markers || []));
      this.paths = JSON.parse(JSON.stringify(initialData?.paths || []));
      this.walls = JSON.parse(JSON.stringify(initialData?.walls || []));
      this.stickers = JSON.parse(JSON.stringify(initialData?.stickers || []));
    }

    const rawColors = (rulerColors && rulerColors.length)
      ? rulerColors.map(c => typeof c === "string" ? c : c.hex)
      : ["#EF4444", "#2563EB", "#16A34A", "#D97706", "#9333EA", "#111827"];
    this.colors = rawColors.filter(Boolean);
    this.activeColor = this.colors[0] || "#EF4444";
    this.onSave = onSave;

    this.tool = "RULER";
    this.activeStamp = "13A孖蘇";
    this.fontFactor = Number(localStorage.getItem("mc_font_factor")) || 1.0;
    this.lineFactor = Number(localStorage.getItem("mc_line_factor")) || 1.0;

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.history = [];
    this.redoStack = [];
    this.selectedObj = null;
    this.inlineState = null;
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
        this.preloadStickers();
        this.initUI();
        this.fitToScreen();
      }
      this.render();
    };
    im.onerror = () => {
      if (im.crossOrigin) {
        const fb = new Image();
        fb.onload = () => {
          this.img = fb;
          this.natW = fb.naturalWidth || 1200;
          this.natH = fb.naturalHeight || 900;
          if (isInitial) {
            this.preloadStickers();
            this.initUI();
            this.fitToScreen();
          }
          this.render();
        };
        fb.src = src;
      }
    };
    im.src = src;
  }

  preloadStickers() {
    this.stickers.forEach(st => {
      const src = st.url || st.src || st.dataUrl;
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
      imageUrl: this.imageUrl, lines: this.lines, markers: this.markers, paths: this.paths, walls: this.walls, stickers: this.stickers
    }));
    if (this.history.length > 40) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.history.length) return;
    this.commitInline(false);
    this.redoStack.push(JSON.stringify({
      imageUrl: this.imageUrl, lines: this.lines, markers: this.markers, paths: this.paths, walls: this.walls, stickers: this.stickers
    }));
    const prev = JSON.parse(this.history.pop());
    this.lines = prev.lines || [];
    this.markers = prev.markers || [];
    this.paths = prev.paths || [];
    this.walls = prev.walls || [];
    this.stickers = prev.stickers || [];
    this.preloadStickers();
    this.selectedObj = null;
    this.updateHUD(false);
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
    this.commitInline(false);
    this.history.push(JSON.stringify({
      imageUrl: this.imageUrl, lines: this.lines, markers: this.markers, paths: this.paths, walls: this.walls, stickers: this.stickers
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
      this.onSave({
        lines: this.lines,
        markers: this.markers,
        paths: this.paths,
        walls: this.walls,
        stickers: this.stickers
      });
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
            <button type="button" id="mc-undo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563; padding:3px 9px; font-size:12px;">↩ 復原</button>
            <button type="button" id="mc-redo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563; padding:3px 9px; font-size:12px;">↪ 重做</button>
          </div>
        </div>

        <div id="mc-viewport" style="position:relative; width:100%; height:74vh; min-height:440px; background:#0F172A; overflow:hidden; touch-action:none;">
          <canvas id="mc-canvas" style="display:block; width:100%; height:100%;"></canvas>
          <input type="file" id="mc-sticker-input" accept="image/*" class="hidden">

          <!-- 就地直接打字輸入框（零跳窗） -->
          <input type="text" id="mc-inline-input" class="hidden" autocomplete="off" spellcheck="false"
                 style="position:absolute; transform:translate(-50%, -50%); background:rgba(255,255,255,0.96); border:1.5px dashed #2563EB; border-radius:4px; padding:1px 6px; text-align:center; font-weight:700; outline:none; z-index:25; min-width:56px; box-shadow:0 2px 8px rgba(0,0,0,0.22);" />

          <!-- 左側打直懸浮工具條 -->
          <div style="position:absolute; left:10px; top:50%; transform:translateY(-50%); display:flex; flex-direction:column; gap:5px; background:rgba(17,24,39,0.88); backdrop-filter:blur(6px); padding:6px 5px; border-radius:12px; border:1px solid rgba(255,255,255,0.16); box-shadow:0 8px 24px rgba(0,0,0,0.45); z-index:15;">
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
              <button type="button" class="mc-tool-btn" data-tool="${t.id}"
                      style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:44px; padding:5px 2px; border-radius:8px; cursor:pointer; border:1px solid ${t.id === this.tool ? "#60A5FA" : "transparent"}; background:${t.id === this.tool ? "#2563EB" : "transparent"}; color:#FFF;">
                <span style="font-size:15px; line-height:1.1;">${t.icon}</span>
                <span style="font-size:10px; font-weight:700; margin-top:2px;">${t.label}</span>
              </button>
            `).join("")}
          </div>

          <!-- 精緻懸浮印章卡片 -->
          <div id="mc-stamp-drawer" class="hidden" style="position:absolute; left:66px; top:50%; transform:translateY(-50%); width:260px; max-height:70vh; overflow-y:auto; background:rgba(255,255,255,0.96); padding:10px; border-radius:12px; border:1.5px solid #CBD5E1; box-shadow:0 12px 30px rgba(0,0,0,0.4); z-index:19; display:flex; flex-direction:column; gap:8px;">
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

          <!-- 隨身浮動控制條（含一鍵確定合併貼圖） -->
          <div id="mc-move-hud" class="hidden" style="position:absolute; left:72px; top:14px; background:rgba(17,24,39,0.95); border:1px solid rgba(96,165,250,0.7); border-radius:10px; padding:8px 10px; box-shadow:0 10px 26px rgba(0,0,0,0.5); z-index:18; display:flex; flex-direction:column; gap:7px; width:230px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #374151; padding-bottom:4px;">
              <span id="mc-hud-target" style="font-size:11px; font-weight:700; color:#93C5FD;">✋ 移動調整（全域比例）</span>
              <button type="button" id="mc-hud-del" class="hidden" style="background:#DC2626; color:#FFF; border:none; border-radius:4px; padding:2px 6px; font-size:10px; font-weight:700; cursor:pointer;">🗑️ 刪除</button>
            </div>

            <button type="button" id="mc-hud-merge-sticker" class="hidden" style="background:#059669; color:#FFF; border:none; border-radius:6px; padding:6px 8px; font-size:12px; font-weight:700; cursor:pointer; text-align:center;">
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
    this.bindInlineEvents();
    this.bindGlobalShortcuts();
    this.bindPointerEvents();
    window.addEventListener("resize", () => { this.render(); this.positionInline(); });
  }

  startInline(state) {
    this.commitInline(false);
    this.inlineState = state;
    this.inlineInput.value = state.val || "";
    this.inlineInput.placeholder = state.kind === "line" ? "數字(如1755-5)" : "輸入文字...";
    this.inlineInput.style.color = state.color || this.activeColor;
    this.inlineInput.classList.remove("hidden");
    this.positionInline();
    this.render();
    requestAnimationFrame(() => { this.inlineInput.focus(); this.inlineInput.select(); });
  }

  positionInline() {
    if (!this.inlineState || this.inlineInput.classList.contains("hidden")) return;
    let ix = this.inlineState.x, iy = this.inlineState.y, fScale = this.fontFactor;
    if (this.inlineState.kind === "line") {
      const l = this.lines[this.inlineState.lineIdx];
      if (!l) return;
      fScale = l.fontScale || this.fontFactor;
      const splits = Array.isArray(l.splits) ? l.splits : [];
      if (splits.length > 0 && this.inlineState.segIdx >= 0) {
        const ptsT = [0, ...splits, 1];
        const midT = (ptsT[this.inlineState.segIdx] + ptsT[this.inlineState.segIdx + 1]) / 2;
        ix = l.x1 + (l.x2 - l.x1) * midT;
        iy = l.y1 + (l.y2 - l.y1) * midT;
      } else {
        ix = (l.x1 + l.x2) / 2;
        iy = (l.y1 + l.y2) / 2;
      }
    } else if (this.inlineState.kind === "marker" && typeof this.inlineState.markerIdx === "number") {
      const m = this.markers[this.inlineState.markerIdx];
      if (m) { ix = m.x; iy = m.y; fScale = m.fontScale || this.fontFactor; }
    }
    const sx = ix * this.scale + this.offsetX;
    const sy = iy * this.scale + this.offsetY;
    const fs = Math.max(13, Math.round((this.natW / 74) * fScale * this.scale));
    this.inlineInput.style.left = `${sx}px`;
    this.inlineInput.style.top = `${sy}px`;
    this.inlineInput.style.fontSize = `${fs}px`;
    this.inlineInput.style.width = `${Math.max(66, (this.inlineInput.value.length + 2) * fs * 0.72)}px`;
  }

  evalNumber(raw) {
    const clean = String(raw || "").trim().replace(/[^\d.+-]/g, "");
    if (!clean) return "";
    const toks = clean.match(/[+-]?[\d.]+/g);
    if (!toks) return clean;
    const sum = toks.reduce((a, b) => a + (parseFloat(b) || 0), 0);
    return String(Math.round(sum * 100) / 100);
  }

  commitInline(doRender = true) {
    if (!this.inlineState) return;
    const st = this.inlineState;
    const val = this.inlineInput.value.trim();
    this.inlineState = null;
    this.inlineInput.classList.add("hidden");

    if (st.kind === "line") {
      const l = this.lines[st.lineIdx];
      if (l) {
        const numStr = this.evalNumber(val);
        this.pushHistory();
        if (Array.isArray(l.splits) && l.splits.length > 0 && st.segIdx >= 0) {
          if (!Array.isArray(l.segValues)) l.segValues = Array(l.splits.length + 1).fill("");
          l.segValues[st.segIdx] = numStr;
          const total = l.segValues.reduce((s, v) => s + (Number(v) || 0), 0);
          l.text = total > 0 ? String(total) : "";
        } else {
          l.text = numStr;
        }
        this.triggerSave();
      }
    } else if (st.kind === "marker") {
      if (typeof st.markerIdx === "number" && this.markers[st.markerIdx]) {
        if (val) { this.pushHistory(); this.markers[st.markerIdx].text = val; this.triggerSave(); }
      } else if (val) {
        this.pushHistory();
        this.markers.push({ x: st.x, y: st.y, text: val, color: st.color || this.activeColor, isStamp: false });
        this.triggerSave();
      }
    }
    if (doRender) this.render();
  }

  bindInlineEvents() {
    this.inlineInput.addEventListener("input", () => this.positionInline());
    this.inlineInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); this.commitInline(true); }
      else if (e.key === "Escape") { e.preventDefault(); this.inlineState = null; this.inlineInput.classList.add("hidden"); this.render(); }
    });
    this.inlineInput.addEventListener("blur", () => { if (this.inlineState) this.commitInline(true); });
  }

  mergeSelectedStickerIntoBase() {
    if (!this.selectedObj || this.selectedObj.type !== "sticker") return;
    const idx = this.selectedObj.idx;
    const st = this.stickers[idx];
    if (!st || !this.img) return;
    const src = st.url || st.src || st.dataUrl;
    const stImg = src ? this.stickerCache.get(src) : null;
    if (!stImg || !stImg.complete) return;

    const off = document.createElement("canvas");
    off.width = this.natW;
    off.height = this.natH;
    const octx = off.getContext("2d");
    octx.drawImage(this.img, 0, 0, this.natW, this.natH);
    octx.drawImage(stImg, st.x, st.y, st.w, st.h);

    try {
      const merged = off.toDataURL("image/jpeg", 0.92);
      this.pushHistory();
      this.stickers.splice(idx, 1);
      this.selectedObj = null;
      this.imageUrl = merged;
      this.updateHUD(false);
      this.loadBaseImage(merged, false);
      this.triggerSave();
    } catch (e) {
      alert("原底圖受跨網域限制，無法直接合併；請先下載截圖再換底圖上傳。");
    }
  }

  updateHUD(moveNearCursor = false) {
    const hud = document.getElementById("mc-move-hud");
    if (!hud) return;
    if (this.tool !== "PAN") { hud.classList.add("hidden"); return; }

    hud.classList.remove("hidden");
    const targetLabel = document.getElementById("mc-hud-target");
    const delBtn = document.getElementById("mc-hud-del");
    const mergeBtn = document.getElementById("mc-hud-merge-sticker");
    const fontSlider = document.getElementById("mc-font-slider");
    const lineSlider = document.getElementById("mc-line-slider");
    const fontVal = document.getElementById("mc-font-val");
    const lineVal = document.getElementById("mc-line-val");

    let curFont = this.fontFactor, curLine = this.lineFactor;
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

    if (moveNearCursor && this.viewport) {
      const vw = this.viewport.clientWidth || 600, vh = this.viewport.clientHeight || 440;
      let left = Math.max(66, Math.min(vw - 240, this.lastCursorPos.x + 16));
      let top = Math.max(10, Math.min(vh - 170, this.lastCursorPos.y + 16));
      hud.style.left = `${left}px`;
      hud.style.top = `${top}px`;
    }
  }

  bindGlobalShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (!document.body.contains(this.canvas)) return;
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && this.selectedObj) { e.preventDefault(); this.deleteSelected(); }
    });
    window.addEventListener("paste", (e) => {
      if (!document.body.contains(this.canvas)) return;
      for (const it of (e.clipboardData?.items || [])) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) this.addStickerFile(f);
        }
      }
    });
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
    this.updateHUD(false);
    this.render();
    this.triggerSave();
  }

  addStickerFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const im = new Image();
      im.onload = () => {
        const w = Math.min(im.width, this.natW * 0.28);
        const h = w * (im.height / (im.width || 1));
        this.pushHistory();
        const cx = (-this.offsetX + this.viewport.clientWidth / 2) / this.scale;
        const cy = (-this.offsetY + this.viewport.clientHeight / 2) / this.scale;
        this.stickers.push({ x: cx - w / 2, y: cy - h / 2, w, h, url: dataUrl });
        this.stickerCache.set(dataUrl, im);
        this.selectedObj = { type: "sticker", idx: this.stickers.length - 1, part: "body" };
        this.setTool("PAN", true);
        this.render();
        this.triggerSave();
      };
      im.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  setTool(toolId, nearCursor = false) {
    this.commitInline(false);
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
    this.updateHUD(nearCursor);
  }

  bindToolbarEvents() {
    this.container.querySelectorAll(".mc-color-btn, .mc-hud-color").forEach(btn => {
      btn.onclick = () => {
        this.activeColor = btn.dataset.color;
        this.container.querySelectorAll(".mc-color-btn").forEach(b => {
          b.style.border = b.dataset.color === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280";
        });
        if (this.selectedObj) {
          const { type, idx } = this.selectedObj;
          this.pushHistory();
          if (type === "line" && this.lines[idx]) this.lines[idx].color = this.activeColor;
          if (type === "marker" && this.markers[idx]) this.markers[idx].color = this.activeColor;
          if (type === "path" && this.paths[idx]) this.paths[idx].color = this.activeColor;
          this.triggerSave();
        }
        this.render();
      };
    });

    const changeFont = (v, save) => {
      const c = Math.max(0.4, Math.min(2.2, Number(v.toFixed(2))));
      if (this.selectedObj?.type === "line") this.lines[this.selectedObj.idx].fontScale = c;
      else if (this.selectedObj?.type === "marker") this.markers[this.selectedObj.idx].fontScale = c;
      else { this.fontFactor = c; localStorage.setItem("mc_font_factor", String(c)); }
      if (save && this.selectedObj) this.triggerSave();
      this.updateHUD(false);
      this.render();
    };
    const changeLine = (v, save) => {
      const c = Math.max(0.4, Math.min(2.2, Number(v.toFixed(2))));
      if (this.selectedObj?.type === "line") this.lines[this.selectedObj.idx].lineScale = c;
      else if (this.selectedObj?.type === "path") this.paths[this.selectedObj.idx].lineScale = c;
      else { this.lineFactor = c; localStorage.setItem("mc_line_factor", String(c)); }
      if (save && this.selectedObj) this.triggerSave();
      this.updateHUD(false);
      this.render();
    };

    const fsSlider = document.getElementById("mc-font-slider");
    fsSlider.oninput = () => changeFont(Number(fsSlider.value), false);
    fsSlider.onchange = () => changeFont(Number(fsSlider.value), true);
    document.getElementById("mc-font-dec").onclick = () => changeFont(Number(fsSlider.value) - 0.1, true);
    document.getElementById("mc-font-inc").onclick = () => changeFont(Number(fsSlider.value) + 0.1, true);

    const lnSlider = document.getElementById("mc-line-slider");
    lnSlider.oninput = () => changeLine(Number(lnSlider.value), false);
    lnSlider.onchange = () => changeLine(Number(lnSlider.value), true);
    document.getElementById("mc-line-dec").onclick = () => changeLine(Number(lnSlider.value) - 0.1, true);
    document.getElementById("mc-line-inc").onclick = () => changeLine(Number(lnSlider.value) + 0.1, true);

    document.getElementById("mc-hud-del").onclick = () => this.deleteSelected();
    document.getElementById("mc-hud-merge-sticker").onclick = () => this.mergeSelectedStickerIntoBase();

    const stInput = document.getElementById("mc-sticker-input");
    stInput.onchange = (e) => { if (e.target.files?.[0]) this.addStickerFile(e.target.files[0]); stInput.value = ""; };

    this.container.querySelectorAll(".mc-tool-btn").forEach(btn => {
      btn.onclick = () => {
        const next = btn.dataset.tool;
        if (next === "STICKER") { stInput.click(); return; }
        if (next === "STAMP" && this.tool === "STAMP") {
          document.getElementById("mc-stamp-drawer")?.classList.toggle("hidden");
          return;
        }
        this.setTool(next, next === "PAN");
      };
    });

    document.getElementById("mc-stamp-close").onclick = () => document.getElementById("mc-stamp-drawer")?.classList.add("hidden");
    this.container.querySelectorAll(".mc-stamp-chip").forEach(btn => {
      btn.onclick = () => {
        this.activeStamp = btn.dataset.stamp;
        this.container.querySelectorAll(".mc-stamp-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("mc-stamp-drawer")?.classList.add("hidden");
      };
    });

    document.getElementById("mc-fit").onclick = () => { this.fitToScreen(); this.render(); this.positionInline(); };
    document.getElementById("mc-undo").onclick = () => this.undo();
    document.getElementById("mc-redo").onclick = () => this.redo();
  }

  fitToScreen() {
    const rect = this.viewport.getBoundingClientRect();
    const vw = rect.width || 800, vh = rect.height || 500;
    this.scale = Math.min(vw / this.natW, vh / this.natH) * 0.96;
    this.offsetX = (vw - this.natW * this.scale) / 2;
    this.offsetY = (vh - this.natH * this.scale) / 2;
  }

  screenToImg(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - this.offsetX) / this.scale, y: (clientY - rect.top - this.offsetY) / this.scale };
  }

  projectToSeg(pt, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    if (len2 === 0) return { t: 0, dist: Math.hypot(pt.x - x1, pt.y - y1) };
    const t = Math.max(0, Math.min(1, ((pt.x - x1) * dx + (pt.y - y1) * dy) / len2));
    return { t, dist: Math.hypot(pt.x - (x1 + t * dx), pt.y - (y1 + t * dy)) };
  }

  hitTest(pt) {
    const tol = 18 / this.scale;
    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i];
      if (Math.hypot(pt.x - (s.x + s.w), pt.y - (s.y + s.h)) < tol * 1.3) return { type: "sticker", idx: i, part: "resize" };
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) return { type: "sticker", idx: i, part: "body" };
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      if (Math.hypot(pt.x - this.markers[i].x, pt.y - this.markers[i].y) < tol * 1.6) return { type: "marker", idx: i, part: "body" };
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (Math.hypot(pt.x - l.x1, pt.y - l.y1) < tol * 1.2) return { type: "line", idx: i, part: "p1" };
      if (Math.hypot(pt.x - l.x2, pt.y - l.y2) < tol * 1.2) return { type: "line", idx: i, part: "p2" };
      const proj = this.projectToSeg(pt, l.x1, l.y1, l.x2, l.y2);
      if (proj.dist < tol) return { type: "line", idx: i, part: "body", t: proj.t };
    }
    for (let i = this.paths.length - 1; i >= 0; i--) {
      const pts = this.paths[i].points || [];
      for (const n of pts) {
        if (Math.hypot(pt.x - n.x, pt.y - n.y) < tol) return { type: "path", idx: i, part: "body" };
      }
    }
    return null;
  }

  bindPointerEvents() {
    let isDown = false, startPt = null, lastPt = null, draftLine = null, draftPath = null, panStart = null, hasMoved = false, pushed = false;
    let pinchDist = 0, pinchScale = 1;
    const ptrs = new Map();

    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.inlineState) { this.commitInline(true); return; }
      const rect = this.viewport.getBoundingClientRect();
      this.lastCursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (ptrs.size === 2) {
        const a = Array.from(ptrs.values());
        pinchDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        pinchScale = this.scale;
        draftLine = null; draftPath = null;
        return;
      }

      isDown = true; hasMoved = false; pushed = false;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      startPt = imgPt; lastPt = imgPt;

      if (this.tool === "PAN") {
        const hit = this.hitTest(imgPt);
        this.selectedObj = hit;
        if (hit) this.updateHUD(true);
        else { panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY }; this.updateHUD(false); }
        this.render();
      } else if (this.tool === "RULER" || this.tool === "CHAIN") {
        const hit = this.hitTest(imgPt);
        if (hit && hit.type === "line" && hit.part === "body") {
          isDown = false;
          this.handleLineClick(hit.idx, hit.t);
          return;
        }
        draftLine = {
          x1: imgPt.x, y1: imgPt.y, x2: imgPt.x, y2: imgPt.y, color: this.activeColor, text: "",
          splits: this.tool === "CHAIN" ? [0.5] : [], segValues: this.tool === "CHAIN" ? ["", ""] : []
        };
      } else if (this.tool === "PEN") {
        draftPath = { color: this.activeColor, points: [{ x: imgPt.x, y: imgPt.y }] };
      } else if (this.tool === "STAMP") {
        this.pushHistory();
        this.markers.push({ x: imgPt.x, y: imgPt.y, text: this.activeStamp, color: this.activeColor, isStamp: true });
        this.render(); this.triggerSave();
      } else if (this.tool === "TEXT") {
        isDown = false;
        this.startInline({ kind: "marker", x: imgPt.x, y: imgPt.y, val: "", color: this.activeColor });
      } else if (this.tool === "ERASER") {
        const hit = this.hitTest(imgPt);
        if (hit) { this.selectedObj = hit; this.deleteSelected(); }
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const a = Array.from(ptrs.values());
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinchDist > 0) {
          const rect = this.viewport.getBoundingClientRect();
          const mx = (a[0].x + a[1].x) / 2 - rect.left, my = (a[0].y + a[1].y) / 2 - rect.top;
          const ns = Math.max(0.15, Math.min(8, pinchScale * (d / pinchDist)));
          this.offsetX = mx - (mx - this.offsetX) * (ns / this.scale);
          this.offsetY = my - (my - this.offsetY) * (ns / this.scale);
          this.scale = ns;
          this.render(); this.positionInline();
        }
        return;
      }
      if (!isDown) return;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      const dx = imgPt.x - lastPt.x, dy = imgPt.y - lastPt.y;
      if (Math.hypot(imgPt.x - startPt.x, imgPt.y - startPt.y) > 3 / this.scale) hasMoved = true;

      if (this.tool === "PAN") {
        if (this.selectedObj && hasMoved) {
          if (!pushed) { this.pushHistory(); pushed = true; }
          const { type, idx, part } = this.selectedObj;
          if (type === "line") {
            const l = this.lines[idx];
            if (part === "p1") { l.x1 = imgPt.x; l.y1 = imgPt.y; }
            else if (part === "p2") { l.x2 = imgPt.x; l.y2 = imgPt.y; }
            else { l.x1 += dx; l.y1 += dy; l.x2 += dx; l.y2 += dy; }
          } else if (type === "marker") { this.markers[idx].x += dx; this.markers[idx].y += dy; }
          else if (type === "sticker") {
            const s = this.stickers[idx];
            if (part === "resize") { s.w = Math.max(30, imgPt.x - s.x); s.h = Math.max(30, imgPt.y - s.y); }
            else { s.x += dx; s.y += dy; }
          } else if (type === "path") {
            (this.paths[idx].points || []).forEach(n => { n.x += dx; n.y += dy; });
          }
          this.render();
        } else if (panStart) {
          this.offsetX = e.clientX - panStart.x;
          this.offsetY = e.clientY - panStart.y;
          this.render();
        }
      } else if (draftLine) {
        const tdx = imgPt.x - startPt.x, tdy = imgPt.y - startPt.y;
        if (Math.abs(tdy) < Math.abs(tdx) * 0.06) { draftLine.x2 = imgPt.x; draftLine.y2 = startPt.y; }
        else if (Math.abs(tdx) < Math.abs(tdy) * 0.06) { draftLine.x2 = startPt.x; draftLine.y2 = imgPt.y; }
        else { draftLine.x2 = imgPt.x; draftLine.y2 = imgPt.y; }
        this.render(draftLine, null);
      } else if (draftPath) {
        draftPath.points.push({ x: imgPt.x, y: imgPt.y });
        this.render(null, draftPath);
      }
      lastPt = imgPt;
    });

    const endPtr = (e) => {
      ptrs.delete(e.pointerId);
      if (this.tool === "PAN" && isDown && !hasMoved && this.selectedObj) {
        const { type, idx } = this.selectedObj;
        if (type === "line") {
          const proj = this.projectToSeg(startPt, this.lines[idx].x1, this.lines[idx].y1, this.lines[idx].x2, this.lines[idx].y2);
          this.handleLineClick(idx, proj.t);
        } else if (type === "marker") {
          const m = this.markers[idx];
          this.startInline({ kind: "marker", markerIdx: idx, x: m.x, y: m.y, val: m.text || "", color: m.color });
        }
      }
      if (pushed) this.triggerSave();
      if (draftLine) {
        if (Math.hypot(draftLine.x2 - draftLine.x1, draftLine.y2 - draftLine.y1) > 15 / this.scale) {
          this.pushHistory();
          this.lines.push(draftLine);
          const idx = this.lines.length - 1;
          this.render(); this.triggerSave();
          this.handleLineClick(idx, 0.25);
        } else { this.render(); }
        draftLine = null;
      }
      if (draftPath) {
        if (draftPath.points.length > 1) { this.pushHistory(); this.paths.push(draftPath); this.render(); this.triggerSave(); }
        draftPath = null;
      }
      isDown = false; panStart = null;
    };

    this.canvas.addEventListener("pointerup", endPtr);
    this.canvas.addEventListener("pointercancel", endPtr);
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const ns = Math.max(0.15, Math.min(8, this.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
      this.offsetX = mx - (mx - this.offsetX) * (ns / this.scale);
      this.offsetY = my - (my - this.offsetY) * (ns / this.scale);
      this.scale = ns;
      this.render(); this.positionInline();
    }, { passive: false });
  }

  handleLineClick(lineIdx, t) {
    const l = this.lines[lineIdx];
    if (!l) return;
    if (!Array.isArray(l.splits)) l.splits = [];
    if (!Array.isArray(l.segValues)) l.segValues = [];

    if (this.tool === "CHAIN" && t > 0.06 && t < 0.94) {
      const near = l.splits.findIndex(sp => Math.abs(sp - t) < 0.04);
      this.pushHistory();
      if (near !== -1) { l.splits.splice(near, 1); l.segValues.splice(near, 1); }
      else {
        if (l.splits.length === 0 && l.text) l.segValues = [String(l.text), ""];
        l.splits.push(t); l.splits.sort((a, b) => a - b);
        l.segValues.splice(l.splits.indexOf(t) + 1, 0, "");
      }
      this.render(); this.triggerSave();
    }

    const hasSplits = l.splits.length > 0;
    let segIdx = hasSplits ? l.splits.findIndex(sp => t <= sp) : -1;
    if (hasSplits && segIdx === -1) segIdx = l.splits.length;
    const initVal = hasSplits ? String(l.segValues[segIdx] || "") : String(l.text || "");
    this.startInline({ kind: "line", lineIdx, segIdx, val: initVal, color: l.color });
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
      const src = st.url || st.src || st.dataUrl;
      const im = src ? this.stickerCache.get(src) : null;
      if (im && im.complete) ctx.drawImage(im, st.x, st.y, st.w, st.h);
      if (this.selectedObj?.type === "sticker" && this.selectedObj?.idx === idx) {
        ctx.strokeStyle = "#2563EB";
        ctx.lineWidth = 2 / this.scale;
        ctx.strokeRect(st.x, st.y, st.w, st.h);
        const hs = 9 / this.scale;
        ctx.fillStyle = "#2563EB";
        ctx.fillRect(st.x + st.w - hs / 2, st.y + st.h - hs / 2, hs, hs);
      }
    });

    const allPaths = draftPath ? [...this.paths, draftPath] : this.paths;
    allPaths.forEach((p, idx) => {
      const pts = p.points || [];
      if (pts.length < 2) return;
      const isSel = this.selectedObj?.type === "path" && this.selectedObj?.idx === idx;
      ctx.strokeStyle = isSel ? "#F59E0B" : (p.color || "#111827");
      ctx.lineWidth = Math.max(1.3, (this.natW / 650) * (p.lineScale || this.lineFactor));
      ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach((n, i) => i === 0 ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y));
      ctx.stroke();
    });

    const allLines = draftLine ? [...this.lines, draftLine] : this.lines;
    allLines.forEach((l, idx) => {
      const isSel = this.selectedObj?.type === "line" && this.selectedObj?.idx === idx;
      this.drawRulerLine(ctx, l, isSel, idx);
    });

    this.markers.forEach((m, idx) => {
      if (this.inlineState?.kind === "marker" && this.inlineState?.markerIdx === idx) return;
      const isSel = this.selectedObj?.type === "marker" && this.selectedObj?.idx === idx;
      const txt = m.text || "";
      if (!txt) return;
      const fs = Math.max(10, Math.round((this.natW / 74) * (m.fontScale || this.fontFactor)));
      this.drawTightText(ctx, txt, m.x, m.y, fs, isSel ? "#F59E0B" : (m.color || "#2563EB"), m.isStamp === true);
    });

    ctx.restore();
  }

  drawTightText(ctx, text, x, y, fontSize, color, filled) {
    ctx.save();
    ctx.font = `700 ${fontSize}px -apple-system, sans-serif`;
    const mw = ctx.measureText(text).width;
    const bw = mw + Math.max(4, fontSize * 0.32), bh = fontSize * 1.18;
    ctx.fillStyle = filled ? color : "rgba(255,255,255,0.95)";
    ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
    ctx.fillStyle = filled ? "#FFF" : color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  drawRulerLine(ctx, l, isSel, idx) {
    const color = l.color || "#2563EB";
    const lw = Math.max(1.2, (this.natW / 760) * (l.lineScale || this.lineFactor));
    const headLen = lw * 3.1;
    const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
    const fs = Math.max(10, Math.round((this.natW / 74) * (l.fontScale || this.fontFactor)));
    const editing = this.inlineState?.kind === "line" && this.inlineState?.lineIdx === idx;

    ctx.save();
    ctx.strokeStyle = isSel ? "#F59E0B" : color;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();

    const endMark = (x, y, ang) => {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + headLen * Math.cos(ang + 0.38), y + headLen * Math.sin(ang + 0.38));
      ctx.moveTo(x, y); ctx.lineTo(x + headLen * Math.cos(ang - 0.38), y + headLen * Math.sin(ang - 0.38));
      ctx.stroke();
    };
    endMark(l.x1, l.y1, angle);
    endMark(l.x2, l.y2, angle + Math.PI);

    const splits = Array.isArray(l.splits) ? l.splits : [];
    if (splits.length > 0) {
      splits.forEach(t => {
        const sx = l.x1 + (l.x2 - l.x1) * t, sy = l.y1 + (l.y2 - l.y1) * t;
        ctx.beginPath();
        ctx.moveTo(sx - headLen * Math.cos(angle + 1.05), sy - headLen * Math.sin(angle + 1.05));
        ctx.lineTo(sx + headLen * Math.cos(angle + 1.05), sy + headLen * Math.sin(angle + 1.05));
        ctx.stroke();
      });
      const ptsT = [0, ...splits, 1];
      const segVals = l.segValues || [];
      let total = 0;
      for (let i = 0; i < ptsT.length - 1; i++) {
        total += Number(segVals[i]) || 0;
        if (editing && this.inlineState?.segIdx === i) continue;
        const midT = (ptsT[i] + ptsT[i + 1]) / 2;
        this.drawTightText(ctx, segVals[i] ? String(segVals[i]) : "·", l.x1 + (l.x2 - l.x1) * midT, l.y1 + (l.y2 - l.y1) * midT, fs, color, false);
      }
      if (total > 0) {
        this.drawTightText(ctx, `總:${total}`, (l.x1 + l.x2) / 2 + Math.sin(angle) * fs * 1.15, (l.y1 + l.y2) / 2 - Math.cos(angle) * fs * 1.15, Math.round(fs * 0.92), color, false);
      }
    } else if (!editing && l.text) {
      this.drawTightText(ctx, String(l.text), (l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2, fs, color, false);
    }
    ctx.restore();
  }
}
