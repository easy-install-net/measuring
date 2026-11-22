const STAMP_GROUPS = [
  { name: "審圖批改", items: ["❌ 需修改", "✅ 確認無誤", "⚠️ 現場核對", "🔄 改尺寸", "📌 待補資料"] },
  { name: "電掣", items: ["13A單蘇", "13A孖蘇", "燈掣", "雙控掣", "數據掣", "電視掣", "冷氣掣", "曲架掣", "電箱"] },
  { name: "水煤", items: ["冷水喉", "熱水喉", "去水位", "地台去水", "煤氣掣", "煤氣錶"] },
  { name: "收口/結構", items: ["收口條", "見光板", "石膏線", "燈槽", "假天花底", "橫樑陣位", "柱位", "暗門", "地腳線"] }
];

const REVIEW_STAMPS = new Set(["❌ 需修改", "⚠️ 現場核對", "🔄 改尺寸", "📌 待補資料"]);

const PALETTE_COLORS = [
  "#1E293B", // 碳黑
  "#2563EB", // 亮藍
  "#16A34A", // 鮮綠
  "#9333EA", // 亮紫
  "#EF4444", // 鮮紅
  "#F97316", // 亮橙
  "#FACC15", // 螢光黃
  "#FFFFFF"  // 純白
];

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, rulerColors, onSave, navHooks = {}) {
    this.container = container;
    this.imageUrl = imageUrl;
    this.navHooks = navHooks;
    this.pageTitle = navHooks.pageTitle || "批改圖紙";

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

    this.colors = [...PALETTE_COLORS];
    this.activeColor = "#EF4444";
    this.onSave = onSave;

    this.tool = "RULER";
    this.activeStamp = "❌ 需修改";
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
    this.isWhiteBg = false;

    this.calcExpr = "";
    this.calcHistory = [];

    this.loadBaseImage(imageUrl, true);
  }

  toggleWhiteBackground() {
    this.isWhiteBg = !this.isWhiteBg;
    this.render();
    return this.isWhiteBg;
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
    this.updateObjectHUD();
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

  triggerSave(extra = {}) {
    if (this.onSave) {
      this.onSave({
        lines: this.lines,
        markers: this.markers,
        paths: this.paths,
        walls: this.walls,
        stickers: this.stickers,
        ...extra
      });
    }
  }

  initUI() {
    this.container.innerHTML = `
      <div class="mc-wrapper" style="width:100%; height:100%; background:#0F172A; display:flex; flex-direction:column; user-select:none; overflow:hidden;">
        <!-- 頂部單行極簡工具列：拉桿改為極簡「字」「粗」並向右靠攏靠近色盤 -->
        <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 10px; background:#1F2937; border-bottom:1px solid #374151; flex-wrap:wrap; gap:8px; z-index:20;">
          <div style="flex:1;"></div>

          <!-- 中央偏左：極簡「字」「粗」拉桿 + 8 色盤 -->
          <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="font-size:12px; color:#E5E7EB; font-weight:800;">字</span>
                <input type="range" id="mc-def-font" min="0.4" max="2.2" step="0.05" value="${this.fontFactor}" style="width:62px; accent-color:#3B82F6; cursor:pointer;">
              </div>
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="font-size:12px; color:#E5E7EB; font-weight:800;">粗</span>
                <input type="range" id="mc-def-line" min="0.4" max="2.2" step="0.05" value="${this.lineFactor}" style="width:62px; accent-color:#10B981; cursor:pointer;">
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:6px;">
              ${this.colors.map(c => `
                <button type="button" class="mc-color-btn" data-color="${c}"
                        style="width:20px; height:20px; border-radius:50%; background:${c}; border:${c === this.activeColor ? "2.5px solid #38BDF8" : "1.5px solid #9CA3AF"}; box-shadow:0 0 3px rgba(0,0,0,0.8); cursor:pointer;"></button>
              `).join("")}
            </div>
          </div>

          <!-- 最右側：純圖示按鈕（含全合併 📌、重置視角、復原、重做、下載圖紙、全螢幕） -->
          <div style="flex:1; display:flex; justify-content:flex-end; align-items:center; gap:5px;">
            <button type="button" id="mc-merge-all" title="全合併：將所有標註壓進底圖並清空零碎記錄" style="background:#065F46; color:#ECFDF5; border:1px solid #10B981; border-radius:5px; padding:0 7px; height:26px; font-size:11px; font-weight:800; cursor:pointer;">📌 全合併</button>
            <button type="button" id="mc-fit" title="重置視角" style="background:#374151; color:#FFF; border:1px solid #4B5563; border-radius:5px; width:28px; height:26px; font-size:14px; cursor:pointer;">⊡</button>
            <button type="button" id="mc-undo" title="復原" style="background:#374151; color:#FFF; border:1px solid #4B5563; border-radius:5px; width:28px; height:26px; font-size:14px; cursor:pointer;">↩</button>
            <button type="button" id="mc-redo" title="重做" style="background:#374151; color:#FFF; border:1px solid #4B5563; border-radius:5px; width:28px; height:26px; font-size:14px; cursor:pointer;">↪</button>
            <button type="button" id="mc-export-img" title="下載圖紙（以當前圖名儲存）" style="background:#374151; color:#FFF; border:1px solid #4B5563; border-radius:5px; width:28px; height:26px; font-size:14px; cursor:pointer;">📸</button>
            <button type="button" id="mc-browser-fs" title="切換瀏覽器全螢幕" style="background:#374151; color:#FFF; border:1px solid #4B5563; border-radius:5px; width:28px; height:26px; font-size:14px; cursor:pointer;">⛶</button>
          </div>
        </div>

        <!-- 滿版畫布主視窗 -->
        <div id="mc-viewport" style="position:relative; flex:1; width:100%; height:100%; background:#0F172A; overflow:hidden; touch-action:none;">
          <canvas id="mc-canvas" style="display:block; width:100%; height:100%;"></canvas>
          <input type="file" id="mc-sticker-input" accept="image/*" class="hidden">

          ${this.navHooks.hasPrev ? `
            <button type="button" id="mc-side-prev" title="上一頁"
                    style="position:absolute; left:8px; top:50%; transform:translateY(-50%); width:36px; height:58px; border-radius:10px; background:rgba(17,24,39,0.72); color:#FFF; border:1px solid rgba(255,255,255,0.22); font-size:24px; font-weight:700; cursor:pointer; z-index:16; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);">‹</button>
          ` : ""}
          ${this.navHooks.hasNext ? `
            <button type="button" id="mc-side-next" title="下一頁"
                    style="position:absolute; right:8px; top:50%; transform:translateY(-50%); width:36px; height:58px; border-radius:10px; background:rgba(17,24,39,0.72); color:#FFF; border:1px solid rgba(255,255,255,0.22); font-size:24px; font-weight:700; cursor:pointer; z-index:16; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);">›</button>
          ` : ""}

          <!-- 打橫可自由拖拉浮動工具條 -->
          <div id="mc-float-dock" style="position:absolute; top:12px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:3px; background:rgba(17,24,39,0.88); backdrop-filter:blur(6px); padding:4px 7px; border-radius:12px; border:1px solid rgba(255,255,255,0.2); box-shadow:0 8px 24px rgba(0,0,0,0.45); z-index:17;">
            <div id="mc-dock-drag" title="按住拖拉工具列位置" style="cursor:grab; color:#9CA3AF; font-size:13px; padding:4px 3px; letter-spacing:-2px;">⋮⋮</div>
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
                      style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:38px; padding:4px 4px; border-radius:8px; cursor:pointer; border:1px solid ${t.id === this.tool ? "#60A5FA" : "transparent"}; background:${t.id === this.tool ? "#2563EB" : "transparent"}; color:#FFF;">
                <span style="font-size:14px; line-height:1.1;">${t.icon}</span>
                <span style="font-size:9px; font-weight:700; margin-top:2px;">${t.label}</span>
              </button>
            `).join("")}
            <div style="width:1px; height:22px; background:#374151; margin:0 2px;"></div>
            <button type="button" id="mc-toggle-calc"
                    style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:38px; padding:4px 4px; border-radius:8px; cursor:pointer; border:1px solid transparent; background:transparent; color:#FACC15;">
              <span style="font-size:14px; line-height:1.1;">🧮</span>
              <span style="font-size:9px; font-weight:700; margin-top:2px;">計數機</span>
            </button>
          </div>

          <!-- 就地直接打字輸入框 -->
          <input type="text" id="mc-inline-input" class="hidden" autocomplete="off" spellcheck="false"
                 style="position:absolute; transform:translate(-50%, -50%); background:rgba(15,23,42,0.82); border:1.5px dashed #38BDF8; border-radius:4px; padding:1px 6px; text-align:center; font-weight:800; outline:none; z-index:25; min-width:56px;" />

          <!-- 精緻懸浮印章卡片 -->
          <div id="mc-stamp-drawer" class="hidden" style="position:absolute; left:50%; top:64px; transform:translateX(-50%); width:290px; max-height:66vh; overflow-y:auto; background:rgba(255,255,255,0.97); padding:10px; border-radius:12px; border:1.5px solid #CBD5E1; box-shadow:0 12px 30px rgba(0,0,0,0.45); z-index:19; display:flex; flex-direction:column; gap:8px;">
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

          <!-- 極簡隨身迷你控制條（點合併 📌 合併底圖 + 單一物件獨立縮放） -->
          <div id="mc-obj-hud" class="hidden" style="position:absolute; left:50%; bottom:16px; transform:translateX(-50%); background:rgba(17,24,39,0.92); border:1px solid rgba(96,165,250,0.65); border-radius:10px; padding:6px 10px; box-shadow:0 8px 20px rgba(0,0,0,0.45); z-index:18; display:flex; align-items:center; gap:10px;">
            <div id="mc-obj-font-row" class="hidden" style="display:flex; align-items:center; gap:5px;">
              <span style="font-size:11px; color:#E5E7EB; font-weight:700;">字</span>
              <input type="range" id="mc-obj-font" min="0.4" max="2.5" step="0.05" value="1" style="width:72px; accent-color:#3B82F6; cursor:pointer;">
            </div>
            <div id="mc-obj-line-row" class="hidden" style="display:flex; align-items:center; gap:5px;">
              <span style="font-size:11px; color:#E5E7EB; font-weight:700;">線</span>
              <input type="range" id="mc-obj-line" min="0.4" max="2.5" step="0.05" value="1" style="width:72px; accent-color:#10B981; cursor:pointer;">
            </div>
            <button type="button" id="mc-obj-merge" title="點合併：把這個物件燒進底圖並移除記錄" style="background:#059669; color:#FFF; border:none; border-radius:5px; padding:4px 8px; font-size:11px; font-weight:700; cursor:pointer;">📌 合併底圖</button>
            <button type="button" id="mc-obj-del" style="background:#DC2626; color:#FFF; border:none; border-radius:5px; padding:4px 8px; font-size:11px; font-weight:700; cursor:pointer;">🗑️</button>
          </div>

          <!-- 精緻小巧可拖動計數機（含 10 行歷史記錄） -->
          <div id="mc-calc-box" class="hidden" style="position:absolute; right:52px; top:64px; width:178px; background:rgba(17,24,39,0.95); border:1px solid #4B5563; border-radius:10px; padding:6px; box-shadow:0 12px 28px rgba(0,0,0,0.55); z-index:22; display:flex; flex-direction:column; gap:5px;">
            <div id="mc-calc-drag" style="display:flex; justify-content:space-between; align-items:center; cursor:grab;">
              <span style="font-size:10px; color:#9CA3AF; font-weight:700;">🧮 計數機（可拖拉）</span>
              <button type="button" id="mc-calc-close" style="background:none; border:none; color:#9CA3AF; font-size:12px; cursor:pointer; padding:0 2px;">✕</button>
            </div>

            <!-- 10 行計算歷史記錄區 -->
            <div id="mc-calc-hist" style="height:112px; overflow-y:auto; background:#0B1120; border:1px solid #1E293B; border-radius:5px; padding:3px 5px; display:flex; flex-direction:column; gap:2px; font-size:10px; color:#94A3B8;">
              <div style="color:#475569; text-align:center; padding-top:36px;">尚無計算記錄</div>
            </div>

            <div style="display:flex; gap:3px;">
              <input type="text" id="mc-calc-display" readonly value="0" style="flex:1; width:100%; background:#0F172A; color:#FACC15; border:1px solid #374151; border-radius:5px; padding:3px 5px; font-size:14px; font-weight:800; text-align:right;" />
              <button type="button" id="mc-calc-copy" title="複製數字" style="background:#2563EB; color:#FFF; border:none; border-radius:5px; padding:0 6px; font-size:10px; font-weight:700; cursor:pointer;">複製</button>
            </div>

            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:3px;">
              ${["C", "⌫", "/", "*", "7", "8", "9", "-", "4", "5", "6", "+", "1", "2", "3", "=", "0", "."].map(k => `
                <button type="button" class="mc-calc-key" data-k="${k}"
                        style="padding:5px 0; border-radius:5px; border:none; font-size:12px; font-weight:700; cursor:pointer; grid-column:${k === "0" ? "span 2" : (k === "=" ? "span 2" : "auto")}; background:${k === "=" ? "#10B981" : (["/", "*", "-", "+"].includes(k) ? "#374151" : (["C", "⌫"].includes(k) ? "#7F1D1D" : "#1F2937"))}; color:#FFF;">${k}</button>
              `).join("")}
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
    this.bindDraggableFloaters();
    this.bindCalculatorEvents();
    this.bindInlineEvents();
    this.bindGlobalShortcuts();
    this.bindPointerEvents();
    window.addEventListener("resize", () => { this.render(); this.positionInline(); });
  }

  makeDraggable(boxEl, handleEl) {
    if (!boxEl || !handleEl) return;
    let dragging = false, sx = 0, sy = 0, bl = 0, bt = 0;
    handleEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      dragging = true;
      handleEl.setPointerCapture(e.pointerId);
      const rect = boxEl.getBoundingClientRect();
      const vRect = this.viewport.getBoundingClientRect();
      boxEl.style.transform = "none";
      boxEl.style.right = "auto";
      boxEl.style.bottom = "auto";
      boxEl.style.left = `${rect.left - vRect.left}px`;
      boxEl.style.top = `${rect.top - vRect.top}px`;
      sx = e.clientX; sy = e.clientY;
      bl = rect.left - vRect.left;
      bt = rect.top - vRect.top;
    });
    handleEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
      const nx = Math.max(4, Math.min(vw - boxEl.offsetWidth - 4, bl + (e.clientX - sx)));
      const ny = Math.max(4, Math.min(vh - boxEl.offsetHeight - 4, bt + (e.clientY - sy)));
      boxEl.style.left = `${nx}px`;
      boxEl.style.top = `${ny}px`;
    });
    const stop = () => { dragging = false; };
    handleEl.addEventListener("pointerup", stop);
    handleEl.addEventListener("pointercancel", stop);
  }

  bindDraggableFloaters() {
    this.makeDraggable(document.getElementById("mc-float-dock"), document.getElementById("mc-dock-drag"));
    this.makeDraggable(document.getElementById("mc-calc-box"), document.getElementById("mc-calc-drag"));
  }

  renderCalcHistory() {
    const histEl = document.getElementById("mc-calc-hist");
    if (!histEl) return;
    if (!this.calcHistory.length) {
      histEl.innerHTML = `<div style="color:#475569; text-align:center; padding-top:36px;">尚無計算記錄</div>`;
      return;
    }
    histEl.innerHTML = this.calcHistory.map(item => `
      <div class="mc-calc-hist-row" data-ans="${item.ans}"
           style="display:flex; justify-content:space-between; align-items:center; padding:1px 3px; border-radius:3px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="color:#94A3B8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.expr}</span>
        <span style="color:#FACC15; font-weight:800; margin-left:4px;">=${item.ans}</span>
      </div>
    `).join("");

    histEl.querySelectorAll(".mc-calc-hist-row").forEach(row => {
      row.onclick = () => {
        const val = row.dataset.ans;
        this.calcExpr = String(val);
        document.getElementById("mc-calc-display").value = val;
        if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
        if (this.inlineState && !this.inlineInput.classList.contains("hidden")) {
          this.inlineInput.value = val;
          this.inlineInput.focus();
        }
      };
    });
  }

  bindCalculatorEvents() {
    const calcBox = document.getElementById("mc-calc-box");
    const disp = document.getElementById("mc-calc-display");
    const copyBtn = document.getElementById("mc-calc-copy");

    document.getElementById("mc-toggle-calc").onclick = () => calcBox.classList.toggle("hidden");
    document.getElementById("mc-calc-close").onclick = () => calcBox.classList.add("hidden");

    copyBtn.onclick = () => {
      const val = disp.value;
      if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
      if (this.inlineState && !this.inlineInput.classList.contains("hidden")) {
        this.inlineInput.value = val;
        this.inlineInput.focus();
      }
      copyBtn.textContent = "已複製";
      setTimeout(() => { copyBtn.textContent = "複製"; }, 1000);
    };

    this.container.querySelectorAll(".mc-calc-key").forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.k;
        if (k === "C") { this.calcExpr = ""; disp.value = "0"; }
        else if (k === "⌫") { this.calcExpr = this.calcExpr.slice(0, -1); disp.value = this.calcExpr || "0"; }
        else if (k === "=") {
          try {
            const rawExpr = this.calcExpr;
            const safe = rawExpr.replace(/[^0-9+\-*/.()]/g, "");
            const ans = safe ? Function(`"use strict"; return (${safe})`)() : 0;
            const rounded = Math.round(ans * 100) / 100;
            if (safe) {
              this.calcHistory.unshift({ expr: rawExpr, ans: rounded });
              if (this.calcHistory.length > 10) this.calcHistory.pop();
              this.renderCalcHistory();
            }
            this.calcExpr = String(rounded);
            disp.value = this.calcExpr;
          } catch (_) { disp.value = "錯誤"; this.calcExpr = ""; }
        } else {
          this.calcExpr += k;
          disp.value = this.calcExpr;
        }
      };
    });
  }

  startInline(state) {
    this.commitInline(false);
    this.inlineState = state;
    this.inlineInput.value = state.val || "";
    this.inlineInput.placeholder = state.kind === "line" ? "輸入數字..." : "輸入文字...";
    this.inlineInput.style.color = state.color === "#1E293B" ? "#FACC15" : (state.color || "#38BDF8");
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
    const fs = Math.max(14, Math.round((this.natW / 72) * fScale * this.scale));
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

  // 繪製底層底圖（含白底模式支援）
  paintBaseLayer(ctx) {
    if (this.isWhiteBg) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, this.natW, this.natH);
    } else if (this.img) {
      ctx.drawImage(this.img, 0, 0, this.natW, this.natH);
    }
  }

  // 點合併：只把當前選中的單一物件壓進底圖，並移除該物件的獨立記錄
  mergeSelectedObjectIntoBase() {
    if (!this.selectedObj || !this.img) return;
    const { type, idx } = this.selectedObj;

    const off = document.createElement("canvas");
    off.width = this.natW;
    off.height = this.natH;
    const octx = off.getContext("2d");
    this.paintBaseLayer(octx);

    if (type === "sticker" && this.stickers[idx]) {
      const st = this.stickers[idx];
      const src = st.url || st.src || st.dataUrl;
      const im = src ? this.stickerCache.get(src) : null;
      if (!im || !im.complete) return;
      octx.drawImage(im, st.x, st.y, st.w, st.h);
    } else if (type === "line" && this.lines[idx]) {
      this.drawRulerLine(octx, this.lines[idx], false, -1);
    } else if (type === "path" && this.paths[idx]) {
      this.drawStrokePath(octx, this.paths[idx], false);
    } else if (type === "marker" && this.markers[idx]) {
      const m = this.markers[idx];
      const fs = Math.max(12, Math.round((this.natW / 72) * (m.fontScale || this.fontFactor)));
      this.drawHaloText(octx, m.text, m.x, m.y, fs, m.color || "#EF4444", m.isStamp === true);
    } else {
      return;
    }

    try {
      const merged = off.toDataURL("image/jpeg", 0.92);
      this.pushHistory();
      if (type === "sticker") this.stickers.splice(idx, 1);
      else if (type === "line") this.lines.splice(idx, 1);
      else if (type === "path") this.paths.splice(idx, 1);
      else if (type === "marker") this.markers.splice(idx, 1);

      this.selectedObj = null;
      this.isWhiteBg = false;
      this.imageUrl = merged;
      this.updateObjectHUD();
      this.loadBaseImage(merged, false);
      this.triggerSave({ mergedBaseUrl: merged });
    } catch (_) {
      alert("原底圖受跨網域限制，請先點「📸」下載後再重新上傳底圖。");
    }
  }

  // 全合併：把所有標註全部壓平進底圖，並清空所有零碎標註記錄
  mergeAllIntoBase() {
    if (!this.img) return;
    const totalCount = this.lines.length + this.markers.length + this.paths.length + this.stickers.length;
    if (totalCount === 0) {
      alert("目前畫面上沒有需要合併的標註。");
      return;
    }
    if (!confirm(`確定要將全部 ${totalCount} 個標註（拉尺線、文字、手繪、貼圖）合併進底圖，並清空零碎圖層記錄嗎？\n（合併後如需反悔，可按右上角「↩ 復原」）`)) return;

    this.commitInline(false);
    const off = document.createElement("canvas");
    off.width = this.natW;
    off.height = this.natH;
    const octx = off.getContext("2d");
    this.paintBaseLayer(octx);

    this.stickers.forEach(st => {
      const src = st.url || st.src || st.dataUrl;
      const im = src ? this.stickerCache.get(src) : null;
      if (im && im.complete) octx.drawImage(im, st.x, st.y, st.w, st.h);
    });
    this.paths.forEach(p => this.drawStrokePath(octx, p, false));
    this.lines.forEach(l => this.drawRulerLine(octx, l, false, -1));
    this.markers.forEach(m => {
      if (!m.text) return;
      const fs = Math.max(12, Math.round((this.natW / 72) * (m.fontScale || this.fontFactor)));
      this.drawHaloText(octx, m.text, m.x, m.y, fs, m.color || "#EF4444", m.isStamp === true);
    });

    try {
      const merged = off.toDataURL("image/jpeg", 0.92);
      this.pushHistory();
      this.lines = [];
      this.markers = [];
      this.paths = [];
      this.walls = [];
      this.stickers = [];
      this.selectedObj = null;
      this.isWhiteBg = false;
      this.imageUrl = merged;
      this.updateObjectHUD();
      this.loadBaseImage(merged, false);
      this.triggerSave({ mergedBaseUrl: merged });
    } catch (_) {
      alert("原底圖受跨網域限制，請先點「📸」下載後再重新上傳底圖。");
    }
  }

  // 下載匯出圖紙（直接以當前頁面的圖紙名稱命名）
  exportAnnotatedImage() {
    if (!this.img) return;
    this.commitInline(false);

    const off = document.createElement("canvas");
    off.width = this.natW;
    off.height = this.natH;
    const octx = off.getContext("2d");
    this.paintBaseLayer(octx);

    this.stickers.forEach(st => {
      const src = st.url || st.src || st.dataUrl;
      const im = src ? this.stickerCache.get(src) : null;
      if (im && im.complete) octx.drawImage(im, st.x, st.y, st.w, st.h);
    });
    this.paths.forEach(p => this.drawStrokePath(octx, p, false));
    this.lines.forEach(l => this.drawRulerLine(octx, l, false, -1));
    this.markers.forEach(m => {
      if (!m.text) return;
      const fs = Math.max(12, Math.round((this.natW / 72) * (m.fontScale || this.fontFactor)));
      this.drawHaloText(octx, m.text, m.x, m.y, fs, m.color || "#EF4444", m.isStamp === true);
    });

    try {
      const safeFileName = (this.pageTitle || "批改圖紙").replace(/[\\/:*?"<>|]/g, "_").trim();
      const url = off.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName}.png`;
      a.click();
    } catch (_) {
      alert("匯出失敗，請使用系統截圖。");
    }
  }

  updateObjectHUD() {
    const hud = document.getElementById("mc-obj-hud");
    if (!hud) return;
    if (this.tool !== "PAN" || !this.selectedObj) {
      hud.classList.add("hidden");
      return;
    }

    hud.classList.remove("hidden");
    const fontRow = document.getElementById("mc-obj-font-row");
    const lineRow = document.getElementById("mc-obj-line-row");
    const fontInput = document.getElementById("mc-obj-font");
    const lineInput = document.getElementById("mc-obj-line");

    fontRow.classList.add("hidden");
    lineRow.classList.add("hidden");

    const { type, idx } = this.selectedObj;
    if (type === "line" && this.lines[idx]) {
      fontRow.classList.remove("hidden");
      lineRow.classList.remove("hidden");
      fontInput.value = this.lines[idx].fontScale || this.fontFactor;
      lineInput.value = this.lines[idx].lineScale || this.lineFactor;
    } else if (type === "marker" && this.markers[idx]) {
      fontRow.classList.remove("hidden");
      fontInput.value = this.markers[idx].fontScale || this.fontFactor;
    } else if (type === "path" && this.paths[idx]) {
      lineRow.classList.remove("hidden");
      lineInput.value = this.paths[idx].lineScale || this.lineFactor;
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
    this.updateObjectHUD();
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
        this.setTool("PAN");
        this.render();
        this.triggerSave();
      };
      im.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  setTool(toolId) {
    this.commitInline(false);
    this.tool = toolId;
    if (this.tool !== "PAN") this.selectedObj = null;
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
    this.updateObjectHUD();
    this.render();
  }

  bindToolbarEvents() {
    const defFont = document.getElementById("mc-def-font");
    const defLine = document.getElementById("mc-def-line");
    defFont.oninput = () => {
      this.fontFactor = Number(defFont.value);
      localStorage.setItem("mc_font_factor", String(this.fontFactor));
      this.render();
    };
    defLine.oninput = () => {
      this.lineFactor = Number(defLine.value);
      localStorage.setItem("mc_line_factor", String(this.lineFactor));
      this.render();
    };

    this.container.querySelectorAll(".mc-color-btn").forEach(btn => {
      btn.onclick = () => {
        this.activeColor = btn.dataset.color;
        this.container.querySelectorAll(".mc-color-btn").forEach(b => {
          b.style.border = b.dataset.color === this.activeColor ? "2.5px solid #38BDF8" : "1.5px solid #9CA3AF";
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

    const objFont = document.getElementById("mc-obj-font");
    const objLine = document.getElementById("mc-obj-line");
    objFont.oninput = () => {
      if (!this.selectedObj) return;
      const v = Number(objFont.value);
      if (this.selectedObj.type === "line") this.lines[this.selectedObj.idx].fontScale = v;
      else if (this.selectedObj.type === "marker") this.markers[this.selectedObj.idx].fontScale = v;
      this.render();
    };
    objFont.onchange = () => { if (this.selectedObj) this.triggerSave(); };

    objLine.oninput = () => {
      if (!this.selectedObj) return;
      const v = Number(objLine.value);
      if (this.selectedObj.type === "line") this.lines[this.selectedObj.idx].lineScale = v;
      else if (this.selectedObj.type === "path") this.paths[this.selectedObj.idx].lineScale = v;
      this.render();
    };
    objLine.onchange = () => { if (this.selectedObj) this.triggerSave(); };

    document.getElementById("mc-obj-del").onclick = () => this.deleteSelected();
    document.getElementById("mc-obj-merge").onclick = () => this.mergeSelectedObjectIntoBase();
    document.getElementById("mc-merge-all").onclick = () => this.mergeAllIntoBase();

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
        this.setTool(next);
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
    document.getElementById("mc-export-img").onclick = () => this.exportAnnotatedImage();
    document.getElementById("mc-browser-fs").onclick = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    };

    const prevBtn = document.getElementById("mc-side-prev");
    const nextBtn = document.getElementById("mc-side-next");
    if (prevBtn && this.navHooks.onPrev) prevBtn.onclick = this.navHooks.onPrev;
    if (nextBtn && this.navHooks.onNext) nextBtn.onclick = this.navHooks.onNext;
  }

  fitToScreen() {
    const rect = this.viewport.getBoundingClientRect();
    const vw = rect.width || window.innerWidth, vh = rect.height || window.innerHeight;
    this.scale = Math.min(vw / this.natW, vh / this.natH) * 0.97;
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
    let pinchDist = 0, pinchScale = 1, wasPinching = false;
    let clickTimer = null;
    const ptrs = new Map();

    this.canvas.addEventListener("dblclick", (e) => {
      if (this.tool !== "RULER" && this.tool !== "CHAIN" && this.tool !== "PAN") return;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      const hit = this.hitTest(imgPt);
      if (!hit || hit.type !== "line" || hit.part !== "body") return;

      const l = this.lines[hit.idx];
      if (!l) return;
      if (!Array.isArray(l.splits)) l.splits = [];
      if (!Array.isArray(l.segValues)) l.segValues = [];
      const t = hit.t;
      if (t <= 0.05 || t >= 0.95) return;

      const nearSplitIdx = l.splits.findIndex(sp => Math.abs(sp - t) < 0.06);
      this.pushHistory();
      if (nearSplitIdx !== -1) {
        const leftEmpty = !l.segValues[nearSplitIdx];
        const rightEmpty = !l.segValues[nearSplitIdx + 1];
        if (leftEmpty || rightEmpty) {
          const keepVal = l.segValues[nearSplitIdx] || l.segValues[nearSplitIdx + 1] || "";
          l.splits.splice(nearSplitIdx, 1);
          l.segValues.splice(nearSplitIdx, 2, keepVal);
          if (l.splits.length === 0) {
            l.text = keepVal;
            l.segValues = [];
          } else {
            const total = l.segValues.reduce((s, v) => s + (Number(v) || 0), 0);
            l.text = total > 0 ? String(total) : "";
          }
          this.render();
          this.triggerSave();
          return;
        }
      }

      if (l.splits.length === 0 && l.text) l.segValues = [String(l.text), ""];
      else if (l.splits.length === 0) l.segValues = ["", ""];
      l.splits.push(t);
      l.splits.sort((a, b) => a - b);
      const insIdx = l.splits.indexOf(t);
      if (l.segValues.length < l.splits.length + 1) {
        l.segValues.splice(insIdx + 1, 0, "");
      }
      this.render();
      this.triggerSave();
      this.openLineSegmentEditor(hit.idx, t + 0.01);
    });

    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.inlineState) { this.commitInline(true); return; }
      this.canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (ptrs.size >= 2) {
        const a = Array.from(ptrs.values());
        pinchDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        pinchScale = this.scale;
        wasPinching = true;
        draftLine = null; draftPath = null; isDown = false;
        return;
      }

      wasPinching = false;
      isDown = true; hasMoved = false; pushed = false;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      startPt = imgPt; lastPt = imgPt;

      if (this.tool === "PAN") {
        const hit = this.hitTest(imgPt);
        this.selectedObj = hit;
        this.updateObjectHUD();
        if (!hit) panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        this.render();
      } else if (this.tool === "RULER" || this.tool === "CHAIN") {
        const hit = this.hitTest(imgPt);
        if (hit && hit.type === "line" && hit.part === "body") {
          isDown = false;
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            clickTimer = null;
            this.openLineSegmentEditor(hit.idx, hit.t);
          }, 210);
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
        this.render();
        const extra = REVIEW_STAMPS.has(this.activeStamp) ? { newReviewNote: this.activeStamp } : {};
        this.triggerSave(extra);
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
      if (ptrs.size >= 2) {
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
      if (!isDown || wasPinching) return;
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
      if (ptrs.size === 0 && wasPinching) {
        wasPinching = false;
        isDown = false;
        return;
      }
      if (this.tool === "PAN" && isDown && !hasMoved && this.selectedObj) {
        const { type, idx } = this.selectedObj;
        if (type === "line") {
          const proj = this.projectToSeg(startPt, this.lines[idx].x1, this.lines[idx].y1, this.lines[idx].x2, this.lines[idx].y2);
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => { clickTimer = null; this.openLineSegmentEditor(idx, proj.t); }, 210);
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
          this.openLineSegmentEditor(idx, 0.25);
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

  openLineSegmentEditor(lineIdx, t) {
    const l = this.lines[lineIdx];
    if (!l) return;
    const splits = Array.isArray(l.splits) ? l.splits : [];
    const hasSplits = splits.length > 0;
    let segIdx = hasSplits ? splits.findIndex(sp => t <= sp) : -1;
    if (hasSplits && segIdx === -1) segIdx = splits.length;
    const initVal = hasSplits ? String((l.segValues || [])[segIdx] || "") : String(l.text || "");
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

    this.paintBaseLayer(ctx);

    const isPanMode = this.tool === "PAN";

    this.stickers.forEach((st, idx) => {
      const src = st.url || st.src || st.dataUrl;
      const im = src ? this.stickerCache.get(src) : null;
      if (im && im.complete) ctx.drawImage(im, st.x, st.y, st.w, st.h);
      const isSel = this.selectedObj?.type === "sticker" && this.selectedObj?.idx === idx;
      if (isPanMode || isSel) {
        this.drawMoveBox(ctx, st.x, st.y, st.w, st.h, isSel, true);
      }
    });

    const allPaths = draftPath ? [...this.paths, draftPath] : this.paths;
    allPaths.forEach((p, idx) => {
      const isSel = this.selectedObj?.type === "path" && this.selectedObj?.idx === idx;
      this.drawStrokePath(ctx, p, isSel);
      if (isPanMode && (p.points || []).length > 1) {
        const xs = p.points.map(n => n.x), ys = p.points.map(n => n.y);
        const minX = Math.min(...xs) - 6, minY = Math.min(...ys) - 6;
        this.drawMoveBox(ctx, minX, minY, Math.max(...xs) - minX + 6, Math.max(...ys) - minY + 6, isSel, false);
      }
    });

    const allLines = draftLine ? [...this.lines, draftLine] : this.lines;
    allLines.forEach((l, idx) => {
      const isSel = this.selectedObj?.type === "line" && this.selectedObj?.idx === idx;
      this.drawRulerLine(ctx, l, isSel, idx);
      if (isPanMode) {
        const minX = Math.min(l.x1, l.x2) - 10, minY = Math.min(l.y1, l.y2) - 10;
        this.drawMoveBox(ctx, minX, minY, Math.abs(l.x2 - l.x1) + 20, Math.abs(l.y2 - l.y1) + 20, isSel, false);
      }
    });

    this.markers.forEach((m, idx) => {
      if (this.inlineState?.kind === "marker" && this.inlineState?.markerIdx === idx) return;
      const isSel = this.selectedObj?.type === "marker" && this.selectedObj?.idx === idx;
      const txt = m.text || "";
      if (!txt) return;
      const fs = Math.max(11, Math.round((this.natW / 72) * (m.fontScale || this.fontFactor)));
      const box = this.drawHaloText(ctx, txt, m.x, m.y, fs, isSel ? "#FACC15" : (m.color || "#EF4444"), m.isStamp === true);
      if (isPanMode && box) {
        this.drawMoveBox(ctx, box.x, box.y, box.w, box.h, isSel, false);
      }
    });

    ctx.restore();
  }

  drawMoveBox(ctx, x, y, w, h, isSelected, showResizeHandle) {
    ctx.save();
    ctx.strokeStyle = isSelected ? "#FACC15" : "rgba(56, 189, 248, 0.78)";
    ctx.lineWidth = (isSelected ? 2.2 : 1.3) / this.scale;
    if (!isSelected) ctx.setLineDash([5 / this.scale, 4 / this.scale]);
    ctx.strokeRect(x, y, w, h);
    if (isSelected && showResizeHandle) {
      const hs = 9 / this.scale;
      ctx.setLineDash([]);
      ctx.fillStyle = "#FACC15";
      ctx.fillRect(x + w - hs / 2, y + h - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  drawStrokePath(ctx, p, isSel) {
    const pts = p.points || [];
    if (pts.length < 2) return;
    const col = isSel ? "#FACC15" : (p.color || "#EF4444");
    const lw = Math.max(1.5, (this.natW / 620) * (p.lineScale || this.lineFactor));
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = (col === "#1E293B") ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.68)";
    ctx.lineWidth = lw + 1.8;
    ctx.beginPath();
    pts.forEach((n, i) => i === 0 ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y));
    ctx.stroke();

    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    pts.forEach((n, i) => i === 0 ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y));
    ctx.stroke();
    ctx.restore();
  }

  drawHaloText(ctx, text, x, y, fontSize, color, filled) {
    ctx.save();
    ctx.font = `800 ${fontSize}px -apple-system, sans-serif`;
    const mw = ctx.measureText(text).width;
    const bw = mw + Math.max(6, fontSize * 0.35), bh = fontSize * 1.22;

    if (filled) {
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = (color === "#FACC15" || color === "#FFFFFF") ? "#111827" : "#FFFFFF";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, x, y + 0.5);
    } else {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const isLightInk = (color === "#FACC15" || color === "#FFFFFF" || color === "#F97316");
      ctx.strokeStyle = isLightInk ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.94)";
      ctx.lineWidth = Math.max(2.6, fontSize * 0.22);
      ctx.strokeText(text, x, y + 0.5);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y + 0.5);
    }
    ctx.restore();
    return { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh };
  }

  drawRulerLine(ctx, l, isSel, idx) {
    const color = isSel ? "#FACC15" : (l.color || "#EF4444");
    const lw = Math.max(1.4, (this.natW / 720) * (l.lineScale || this.lineFactor));
    const headLen = lw * 3.2;
    const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
    const fs = Math.max(11, Math.round((this.natW / 72) * (l.fontScale || this.fontFactor)));
    const editing = idx >= 0 && this.inlineState?.kind === "line" && this.inlineState?.lineIdx === idx;

    const strokeWithHalo = (drawFn) => {
      ctx.strokeStyle = color === "#1E293B" ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.68)";
      ctx.lineWidth = lw + 1.8;
      drawFn();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      drawFn();
    };

    ctx.save();
    strokeWithHalo(() => {
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x1 + headLen * Math.cos(angle + 0.38), l.y1 + headLen * Math.sin(angle + 0.38));
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x1 + headLen * Math.cos(angle - 0.38), l.y1 + headLen * Math.sin(angle - 0.38));
      ctx.moveTo(l.x2, l.y2);
      ctx.lineTo(l.x2 + headLen * Math.cos(angle + Math.PI + 0.38), l.y2 + headLen * Math.sin(angle + Math.PI + 0.38));
      ctx.moveTo(l.x2, l.y2);
      ctx.lineTo(l.x2 + headLen * Math.cos(angle + Math.PI - 0.38), l.y2 + headLen * Math.sin(angle + Math.PI - 0.38));
      ctx.stroke();
    });

    const splits = Array.isArray(l.splits) ? l.splits : [];
    if (splits.length > 0) {
      strokeWithHalo(() => {
        ctx.beginPath();
        splits.forEach(t => {
          const sx = l.x1 + (l.x2 - l.x1) * t, sy = l.y1 + (l.y2 - l.y1) * t;
          ctx.moveTo(sx - headLen * Math.cos(angle + 1.05), sy - headLen * Math.sin(angle + 1.05));
          ctx.lineTo(sx + headLen * Math.cos(angle + 1.05), sy + headLen * Math.sin(angle + 1.05));
        });
        ctx.stroke();
      });

      const ptsT = [0, ...splits, 1];
      const segVals = l.segValues || [];
      let total = 0;
      for (let i = 0; i < ptsT.length - 1; i++) {
        total += Number(segVals[i]) || 0;
        if (editing && this.inlineState?.segIdx === i) continue;
        const midT = (ptsT[i] + ptsT[i + 1]) / 2;
        const valText = segVals[i] ? String(segVals[i]) : "?";
        this.drawHaloText(ctx, valText, l.x1 + (l.x2 - l.x1) * midT, l.y1 + (l.y2 - l.y1) * midT, fs, color, false);
      }
      if (total > 0) {
        this.drawHaloText(ctx, `總:${total}`, (l.x1 + l.x2) / 2 + Math.sin(angle) * fs * 1.25, (l.y1 + l.y2) / 2 - Math.cos(angle) * fs * 1.25, Math.round(fs * 0.92), color, false);
      }
    } else if (!editing && l.text) {
      this.drawHaloText(ctx, String(l.text), (l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2, fs, color, false);
    }
    ctx.restore();
  }
}
