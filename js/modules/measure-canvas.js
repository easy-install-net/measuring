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
      const rawStickers = initialData?.stickers || initialData?.images || initialData?.overlays || initialData?.attachments || [];
      this.stickers = JSON.parse(JSON.stringify(rawStickers));
    }

    const rawColors = (rulerColors && rulerColors.length)
      ? rulerColors.map(c => typeof c === "string" ? c : c.hex)
      : ["#EF4444", "#2563EB", "#16A34A", "#D97706", "#9333EA", "#111827"];
    this.colors = rawColors.filter(Boolean);
    this.activeColor = this.colors[0] || "#EF4444";
    this.onSave = onSave;

    this.tool = "RULER"; // PAN | RULER | CHAIN | PEN | STAMP | TEXT | STICKER | ERASER
    this.activeStamp = "13A孖蘇";
    this.sizeFactor = Number(localStorage.getItem("mc_size_factor")) || 1.0;

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.history = [];
    this.redoStack = [];
    this.selectedObj = null; // { type: 'line'|'marker'|'path'|'sticker', idx, part?: 'p1'|'p2'|'body'|'resize' }
    this.activeSegIdx = -1;
    this.keypadVal = "";
    this.stickerCache = new Map();

    this.img = new Image();
    this.img.crossOrigin = "anonymous";
    this.img.onload = () => {
      this.natW = this.img.naturalWidth || 1200;
      this.natH = this.img.naturalHeight || 900;
      this.normalizeLegacyCoordinates();
      this.preloadStickers();
      this.initUI();
      this.fitToScreen();
      this.render();
    };
    this.img.src = imageUrl;
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
      // 兼容舊版 chainSegs 轉為新版 splits + segValues
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
      if (isNorm(st.x) && isNorm(st.y)) {
        st.x *= this.natW;
        st.y *= this.natH;
      }
      if (isNorm(st.w) && isNorm(st.h)) {
        st.w *= this.natW;
        st.h *= this.natH;
      }
      if (!st.w) st.w = Math.round(this.natW * 0.24);
      if (!st.h) st.h = Math.round(this.natH * 0.24);
    });
  }

  preloadStickers() {
    this.stickers.forEach(st => {
      const src = st.url || st.src || st.imageUrl || st.dataUrl;
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
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      walls: this.walls,
      stickers: this.stickers
    }));
    if (this.history.length > 50) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.history.length) return;
    this.redoStack.push(JSON.stringify({
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
    this.closeKeypad();
    this.render();
    this.triggerSave();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.history.push(JSON.stringify({
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
    this.render();
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
        <!-- 頂部控制列：顏色 + 大細調節拉條 + 視角與復原 -->
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:#1F2937; border-bottom:1px solid #374151; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            ${this.colors.map(c => `
              <button type="button" class="mc-color-btn" data-color="${c}"
                      style="width:20px; height:20px; border-radius:50%; background:${c}; border:${c === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280"}; cursor:pointer;"></button>
            `).join("")}
          </div>

          <!-- 自由調節大細拉條 -->
          <div style="display:flex; align-items:center; gap:6px; background:#111827; padding:3px 9px; border-radius:999px; border:1px solid #374151;">
            <span style="font-size:11px; color:#D1D5DB; font-weight:600;">細</span>
            <input type="range" id="mc-size-slider" min="0.45" max="2.0" step="0.05" value="${this.sizeFactor}"
                   style="width:86px; accent-color:#3B82F6; cursor:pointer;" title="自由調節字體與線條大細">
            <span style="font-size:11px; color:#D1D5DB; font-weight:600;">大</span>
            <span id="mc-size-val" style="font-size:11px; color:#93C5FD; min-width:30px; text-align:right;">${Math.round(this.sizeFactor * 100)}%</span>
          </div>

          <div style="display:flex; align-items:center; gap:5px;">
            <button type="button" id="mc-fit" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">重置視角</button>
            <button type="button" id="mc-undo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;" title="Ctrl+Z">↩ 復原</button>
            <button type="button" id="mc-redo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;" title="Ctrl+Y">↪ 重做</button>
          </div>
        </div>

        <!-- 印章快選抽屜 -->
        <div id="mc-stamp-drawer" class="hidden" style="background:#F8FAFC; padding:6px 10px; border-bottom:1px solid #CBD5E1; display:flex; flex-direction:column; gap:5px;">
          ${STAMP_GROUPS.map(g => `
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
              <span style="font-size:11px; font-weight:700; color:#475569; min-width:52px;">${g.name}：</span>
              ${g.items.map(st => `
                <button type="button" class="chip mc-stamp-chip ${st === this.activeStamp ? "active" : ""}" data-stamp="${st}">${st}</button>
              `).join("")}
            </div>
          `).join("")}
        </div>

        <!-- 畫布主視窗 + 左側打直懸浮工具條 -->
        <div id="mc-viewport" style="position:relative; width:100%; height:70vh; min-height:420px; background:#0F172A; overflow:hidden; touch-action:none;">
          <canvas id="mc-canvas" style="display:block; width:100%; height:100%;"></canvas>
          <input type="file" id="mc-sticker-input" accept="image/*" class="hidden">

          <!-- 打直的左側懸浮工具條 -->
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
              <button type="button" class="mc-tool-btn" data-tool="${t.id}" title="${t.label}"
                      style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:44px; padding:5px 2px; border-radius:8px; cursor:pointer; border:1px solid ${t.id === this.tool ? "#60A5FA" : "transparent"}; background:${t.id === this.tool ? "#2563EB" : "transparent"}; color:#FFF; transition:all 0.15s;">
                <span style="font-size:15px; line-height:1.1;">${t.icon}</span>
                <span style="font-size:10px; font-weight:700; margin-top:2px; letter-spacing:0.5px;">${t.label}</span>
              </button>
            `).join("")}
          </div>

          <!-- 浮動數字鍵盤 -->
          <div id="mc-keypad" class="hidden" style="position:absolute; top:10px; right:10px; width:225px; background:rgba(255,255,255,0.97); border:1.5px solid #111827; border-radius:8px; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.35); z-index:20;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span id="mc-kp-title" style="font-size:11px; font-weight:700; color:#374151;">輸入尺寸 (mm)</span>
              <button type="button" id="mc-kp-close" style="border:none; background:none; font-size:15px; cursor:pointer; color:#6B7280;">✕</button>
            </div>
            <div id="mc-kp-segs" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;"></div>
            <div id="mc-kp-display" style="background:#F3F4F6; border:1px solid #9CA3AF; border-radius:4px; padding:5px 8px; font-size:17px; font-weight:800; text-align:right; color:#111827; margin-bottom:6px; min-height:32px;">0</div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; margin-bottom:5px;">
              ${["7","8","9","4","5","6","1","2","3","0","00","⌫"].map(k => `
                <button type="button" class="mc-kp-key" data-key="${k}" style="padding:6px 0; font-size:14px; font-weight:700; background:#FFF; border:1px solid #CBD5E1; border-radius:4px; cursor:pointer;">${k}</button>
              `).join("")}
            </div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px;">
              <button type="button" class="mc-kp-adj" data-adj="-5" style="padding:5px 0; font-size:11px; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; border-radius:4px; cursor:pointer;">-5</button>
              <button type="button" class="mc-kp-adj" data-adj="-7" style="padding:5px 0; font-size:11px; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; border-radius:4px; cursor:pointer;">-7</button>
              <button type="button" class="mc-kp-adj" data-adj="-10" style="padding:5px 0; font-size:11px; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; border-radius:4px; cursor:pointer;">-10</button>
              <button type="button" id="mc-kp-ok" style="padding:5px 0; font-size:11px; font-weight:700; background:#111827; color:#FFF; border:none; border-radius:4px; cursor:pointer;">確定</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.viewport = document.getElementById("mc-viewport");
    this.canvas = document.getElementById("mc-canvas");
    this.ctx = this.canvas.getContext("2d");

    this.bindToolbarEvents();
    this.bindKeyboardAndPaste();
    this.bindPointerEvents();
    window.addEventListener("resize", () => this.render());
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
      } else if ((e.key === "Delete" || e.key === "Backspace") && this.selectedObj && document.getElementById("mc-keypad")?.classList.contains("hidden")) {
        e.preventDefault();
        this.deleteSelected();
      }
    };
    window.addEventListener("keydown", this._keyHandler);

    // 支援 Ctrl+V 直接貼上截圖作為貼圖
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
        this.setActiveTool("PAN");
        this.selectedObj = { type: "sticker", idx: this.stickers.length - 1, part: "body" };
        this.render();
        this.triggerSave();
      };
      tmp.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  setActiveTool(toolId) {
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
  }

  bindToolbarEvents() {
    this.container.querySelectorAll(".mc-color-btn").forEach(btn => {
      btn.onclick = () => {
        this.activeColor = btn.dataset.color;
        this.container.querySelectorAll(".mc-color-btn").forEach(b => {
          b.style.border = b.dataset.color === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280";
        });
        if (this.selectedObj) {
          const { type, idx } = this.selectedObj;
          if (type === "line" && this.lines[idx]) { this.pushHistory(); this.lines[idx].color = this.activeColor; }
          if (type === "marker" && this.markers[idx]) { this.pushHistory(); this.markers[idx].color = this.activeColor; }
          if (type === "path" && this.paths[idx]) { this.pushHistory(); this.paths[idx].color = this.activeColor; }
          this.render();
          this.triggerSave();
        }
      };
    });

    const slider = document.getElementById("mc-size-slider");
    const sizeVal = document.getElementById("mc-size-val");
    slider.oninput = () => {
      this.sizeFactor = Number(slider.value);
      sizeVal.textContent = `${Math.round(this.sizeFactor * 100)}%`;
      localStorage.setItem("mc_size_factor", String(this.sizeFactor));
      this.render();
    };

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
        this.setActiveTool(nextTool);
      };
    });

    this.container.querySelectorAll(".mc-stamp-chip").forEach(btn => {
      btn.onclick = () => {
        this.activeStamp = btn.dataset.stamp;
        this.container.querySelectorAll(".mc-stamp-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      };
    });

    document.getElementById("mc-fit").onclick = () => { this.fitToScreen(); this.render(); };
    document.getElementById("mc-undo").onclick = () => this.undo();
    document.getElementById("mc-redo").onclick = () => this.redo();
    document.getElementById("mc-kp-close").onclick = () => this.closeKeypad();

    this.container.querySelectorAll(".mc-kp-key").forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.key;
        if (k === "⌫") this.keypadVal = this.keypadVal.slice(0, -1);
        else this.keypadVal += k;
        document.getElementById("mc-kp-display").textContent = this.keypadVal || "0";
      };
    });

    this.container.querySelectorAll(".mc-kp-adj").forEach(btn => {
      btn.onclick = () => {
        const cur = Number(this.keypadVal || 0);
        const next = Math.max(0, cur + Number(btn.dataset.adj));
        this.keypadVal = String(next);
        document.getElementById("mc-kp-display").textContent = this.keypadVal;
      };
    });

    document.getElementById("mc-kp-ok").onclick = () => this.commitKeypadValue();
  }

  openKeypad(lineIdx, segIdx = -1) {
    this.selectedObj = { type: "line", idx: lineIdx, part: "body" };
    this.activeSegIdx = segIdx;
    const line = this.lines[lineIdx];
    if (!line) return;

    const kp = document.getElementById("mc-keypad");
    const segsBox = document.getElementById("mc-kp-segs");
    kp.classList.remove("hidden");

    const hasSplits = Array.isArray(line.splits) && line.splits.length > 0;
    if (hasSplits) {
      const segCount = line.splits.length + 1;
      if (!Array.isArray(line.segValues)) line.segValues = Array(segCount).fill("");
      while (line.segValues.length < segCount) line.segValues.push("");
      if (segIdx < 0 || segIdx >= segCount) this.activeSegIdx = 0;

      document.getElementById("mc-kp-title").textContent = `修改第 ${this.activeSegIdx + 1} 段 (共${segCount}段)`;
      segsBox.innerHTML = line.segValues.slice(0, segCount).map((val, idx) => `
        <button type="button" class="chip ${idx === this.activeSegIdx ? "active" : ""}" data-seg="${idx}">
          段${idx + 1}: ${val || 0}
        </button>
      `).join("");
      segsBox.querySelectorAll("[data-seg]").forEach(b => {
        b.onclick = () => this.openKeypad(lineIdx, Number(b.dataset.seg));
      });
      this.keypadVal = String(line.segValues[this.activeSegIdx] || "");
    } else {
      document.getElementById("mc-kp-title").textContent = "輸入尺寸 (mm)（點擊線上可分段）";
      segsBox.innerHTML = "";
      this.keypadVal = String(line.text || line.label || "").replace(/[^\d.]/g, "");
    }

    document.getElementById("mc-kp-display").textContent = this.keypadVal || "0";
    this.render();
  }

  commitKeypadValue() {
    if (!this.selectedObj || this.selectedObj.type !== "line") return;
    const line = this.lines[this.selectedObj.idx];
    if (!line) return;

    this.pushHistory();
    const num = Number(this.keypadVal || 0);
    if (Array.isArray(line.splits) && line.splits.length > 0 && this.activeSegIdx >= 0) {
      line.segValues[this.activeSegIdx] = this.keypadVal ? String(num) : "";
      const total = line.segValues.reduce((sum, v) => sum + (Number(v) || 0), 0);
      line.text = total > 0 ? String(total) : "";
    } else {
      line.text = this.keypadVal ? String(num) : "";
    }
    this.closeKeypad();
    this.render();
    this.triggerSave();
  }

  closeKeypad() {
    const kp = document.getElementById("mc-keypad");
    if (kp) kp.classList.add("hidden");
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

  // 計算點到線段的投影比例 t (0~1) 與垂直距離
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

    // 1. 檢查貼圖（先檢查右下角縮放點，再檢查整體）
    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i];
      if (Math.hypot(pt.x - (s.x + s.w), pt.y - (s.y + s.h)) < tol * 1.3) {
        return { type: "sticker", idx: i, part: "resize" };
      }
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) {
        return { type: "sticker", idx: i, part: "body" };
      }
    }

    // 2. 檢查文字與印章
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      if (Math.hypot(pt.x - m.x, pt.y - m.y) < tol * 1.6) {
        return { type: "marker", idx: i, part: "body" };
      }
    }

    // 3. 檢查拉尺線（端點優先，其次線身）
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

    // 4. 檢查手繪線條
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

    this.canvas.addEventListener("pointerdown", (e) => {
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
        if (!hit) {
          panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
          this.closeKeypad();
        }
        this.render();
      } else if (this.tool === "RULER" || this.tool === "CHAIN") {
        // 如果直接點在現有拉尺線上，支援直接點擊分段或改該段數字
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
        const txt = prompt("輸入備註文字（如：實做闊: 1755、收口: 20）：");
        if (txt && txt.trim()) {
          this.pushHistory();
          this.markers.push({
            x: imgPt.x,
            y: imgPt.y,
            text: txt.trim(),
            color: this.activeColor,
            isStamp: false
          });
          this.render();
          this.triggerSave();
        }
      } else if (this.tool === "ERASER") {
        this.eraseAt(imgPt);
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStartDist > 0) {
          const midX = (pts[0].x + pts[1].x) / 2 - this.canvas.getBoundingClientRect().left;
          const midY = (pts[0].y + pts[1].y) / 2 - this.canvas.getBoundingClientRect().top;
          const nextScale = Math.max(0.15, Math.min(8, pinchStartScale * (dist / pinchStartDist)));
          this.offsetX = midX - (midX - this.offsetX) * (nextScale / this.scale);
          this.offsetY = midY - (midY - this.offsetY) * (nextScale / this.scale);
          this.scale = nextScale;
          this.render();
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
          this.render();
        } else if (panStart) {
          this.offsetX = e.clientX - panStart.x;
          this.offsetY = e.clientY - panStart.y;
          this.render();
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

      // 若在移動模式下「輕點（未拖移）」物件，則進入編輯（拉尺可分段或改數字，文字可改字）
      if (this.tool === "PAN" && isDown && !hasMoved && this.selectedObj) {
        const { type, idx } = this.selectedObj;
        if (type === "line") {
          const proj = this.projectToSegment(startPt, this.lines[idx].x1, this.lines[idx].y1, this.lines[idx].x2, this.lines[idx].y2);
          this.handleLineClickAction(idx, proj.t);
        } else if (type === "marker") {
          const m = this.markers[idx];
          const nextTxt = prompt("修改標註文字：", m.text || "");
          if (nextTxt !== null && nextTxt.trim()) {
            this.pushHistory();
            m.text = nextTxt.trim();
            this.render();
            this.triggerSave();
          }
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
          this.openKeypad(newIdx, 0);
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
    }, { passive: false });
  }

  // 直接在紙上的拉尺線點擊：若在分段工具下點擊新位置則插入分界點；若點在某段數字上則直接修改該段數字
  handleLineClickAction(lineIdx, t) {
    const line = this.lines[lineIdx];
    if (!line) return;
    if (!Array.isArray(line.splits)) line.splits = [];
    if (!Array.isArray(line.segValues)) line.segValues = [];

    if (this.tool === "CHAIN" && t > 0.06 && t < 0.94) {
      // 檢查是否點在現有分界點附近（若是則移除該分界點，否則新增分界點）
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
      this.openKeypad(lineIdx, targetSeg === -1 ? line.splits.length : targetSeg);
      return;
    }

    // 判斷點擊落在哪一段並打開該段數字輸入
    if (line.splits.length > 0) {
      let segIdx = line.splits.findIndex(sp => t <= sp);
      if (segIdx === -1) segIdx = line.splits.length;
      this.openKeypad(lineIdx, segIdx);
    } else {
      this.openKeypad(lineIdx, 0);
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

    // 1. 底圖
    ctx.drawImage(this.img, 0, 0, this.natW, this.natH);

    // 2. 貼圖層
    this.stickers.forEach((st, idx) => {
      const isSel = this.selectedObj?.type === "sticker" && this.selectedObj?.idx === idx;
      this.drawSticker(ctx, st, isSel);
    });

    // 3. 手繪筆跡層
    const allPaths = draftPath ? [...this.paths, draftPath] : this.paths;
    allPaths.forEach((p, idx) => {
      const isSel = this.selectedObj?.type === "path" && this.selectedObj?.idx === idx;
      this.drawFreehandPath(ctx, p, isSel);
    });

    // 4. 牆身線
    this.walls.forEach(w => {
      ctx.save();
      ctx.strokeStyle = w.color || "#111827";
      ctx.lineWidth = Math.max(2, (this.natW / 450) * this.sizeFactor);
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
      ctx.restore();
    });

    // 5. 拉尺與分段拉尺層
    const allLines = draftLine ? [...this.lines, draftLine] : this.lines;
    allLines.forEach((l, idx) => {
      const isSel = this.selectedObj?.type === "line" && this.selectedObj?.idx === idx;
      this.drawRulerLine(ctx, l, isSel);
    });

    // 6. 印章與文字標註層
    this.markers.forEach((m, idx) => {
      const isSel = this.selectedObj?.type === "marker" && this.selectedObj?.idx === idx;
      this.drawMarker(ctx, m, isSel);
    });

    ctx.restore();
  }

  drawSticker(ctx, st, isSelected) {
    const src = st.url || st.src || st.imageUrl || st.dataUrl;
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
      // 右下角縮放控制點
      const hs = 9 / this.scale;
      ctx.fillStyle = "#2563EB";
      ctx.fillRect(st.x + st.w - hs / 2, st.y + st.h - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  drawFreehandPath(ctx, p, isSelected) {
    const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = isSelected ? "#F59E0B" : (p.color || "#111827");
    ctx.lineWidth = Math.max(1.5, (this.natW / 650) * this.sizeFactor);
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

  // 純白底緊貼文字、無黑框輔助繪製
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

  drawRulerLine(ctx, l, isSelected) {
    const color = l.color || "#2563EB";
    const lw = Math.max(1.3, (this.natW / 760) * this.sizeFactor);
    const headLen = lw * 3.1;
    const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
    const fontSize = Math.max(11, Math.round((this.natW / 74) * this.sizeFactor));

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

    // 精巧小箭嘴
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

    // 選中時顯示兩端可拖曳小圓點
    if (isSelected) {
      const r = 4.5 / this.scale;
      ctx.fillStyle = "#F59E0B";
      ctx.beginPath(); ctx.arc(l.x1, l.y1, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(l.x2, l.y2, r, 0, Math.PI * 2); ctx.fill();
    }

    const splits = Array.isArray(l.splits) ? l.splits : [];
    if (splits.length > 0) {
      // 繪製線上分段斜線標記
      const tickLen = headLen * 0.95;
      splits.forEach(t => {
        const sx = l.x1 + (l.x2 - l.x1) * t;
        const sy = l.y1 + (l.y2 - l.y1) * t;
        ctx.beginPath();
        ctx.moveTo(sx - tickLen * Math.cos(angle + Math.PI / 3), sy - tickLen * Math.sin(angle + Math.PI / 3));
        ctx.lineTo(sx + tickLen * Math.cos(angle + Math.PI / 3), sy + tickLen * Math.sin(angle + Math.PI / 3));
        ctx.stroke();
      });

      // 各段獨立數字顯示在對應區段中點
      const ptsT = [0, ...splits, 1];
      const segVals = Array.isArray(l.segValues) ? l.segValues : [];
      let total = 0;
      for (let i = 0; i < ptsT.length - 1; i++) {
        const midT = (ptsT[i] + ptsT[i + 1]) / 2;
        const mx = l.x1 + (l.x2 - l.x1) * midT;
        const my = l.y1 + (l.y2 - l.y1) * midT;
        const vStr = segVals[i] ? String(segVals[i]) : "·";
        total += Number(segVals[i]) || 0;
        this.drawTightText(ctx, vStr, mx, my, fontSize, color, false);
      }

      // 總數自動顯示於線段上方中點
      if (total > 0) {
        const cx = (l.x1 + l.x2) / 2;
        const cy = (l.y1 + l.y2) / 2;
        const perpX = Math.sin(angle) * (fontSize * 1.15);
        const perpY = -Math.cos(angle) * (fontSize * 1.15);
        this.drawTightText(ctx, `總:${total}`, cx + perpX, cy + perpY, Math.max(10, Math.round(fontSize * 0.92)), color, false);
      }
    } else {
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
    const fontSize = Math.max(11, Math.round((this.natW / 74) * this.sizeFactor));
    const isFilledStamp = m.isStamp === true;
    this.drawTightText(ctx, text, m.x, m.y, fontSize, color, isFilledStamp);
  }
}
