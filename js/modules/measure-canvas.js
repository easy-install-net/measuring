export class MeasureCanvas {
  constructor(containerEl, imageUrl, initialLines = [], rulerColors = [], onChange) {
    this.container = containerEl;
    this.imageUrl = imageUrl;
    this.lines = JSON.parse(JSON.stringify(initialLines));
    this.colors = rulerColors.length ? rulerColors : [
      { id: "black", name: "純黑", hex: "#111827" },
      { id: "blue",  name: "工程藍", hex: "#1D4ED8" },
      { id: "green", name: "翠綠", hex: "#15803D" },
      { id: "purple",name: "深紫", hex: "#6D28D9" },
      { id: "red",   name: "警示紅", hex: "#DC2626" }
    ];
    this.activeColor = this.colors[0].hex;
    this.selectedLineId = null;
    this.onChange = onChange;const STAMP_GROUPS = [
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
    } else {
      this.lines = JSON.parse(JSON.stringify(initialData?.lines || []));
      this.markers = JSON.parse(JSON.stringify(initialData?.markers || []));
      this.paths = JSON.parse(JSON.stringify(initialData?.paths || initialData?.strokes || []));
      this.walls = JSON.parse(JSON.stringify(initialData?.walls || []));
    }

    this.colors = (rulerColors && rulerColors.length)
      ? rulerColors
      : ["#EF4444", "#2563EB", "#16A34A", "#D97706", "#9333EA", "#111827"];
    this.activeColor = this.colors[0];
    this.onSave = onSave;

    this.tool = "RULER"; // PAN | RULER | CHAIN | PEN | STAMP | TEXT | ERASER
    this.activeStamp = "13A孖蘇";
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.history = [];
    this.redoStack = [];
    this.selectedLineIdx = -1;
    this.activeSegIdx = -1;
    this.keypadVal = "";

    this.img = new Image();
    this.img.crossOrigin = "anonymous";
    this.img.onload = () => {
      this.natW = this.img.naturalWidth || 1200;
      this.natH = this.img.naturalHeight || 900;
      this.normalizeLegacyCoordinates();
      this.initUI();
      this.fitToScreen();
      this.render();
    };
    this.img.src = imageUrl;
  }

  // 自動判斷舊系統是否使用 0~1 正規化比例座標，並轉為底圖實際像素座標
  normalizeLegacyCoordinates() {
    const isNorm = (v) => typeof v === "number" && v > 0 && v <= 1.05;

    this.lines.forEach(l => {
      if (isNorm(l.x1) && isNorm(l.y1) && isNorm(l.x2) && isNorm(l.y2)) {
        l.x1 *= this.natW;
        l.y1 *= this.natH;
        l.x2 *= this.natW;
        l.y2 *= this.natH;
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
  }

  pushHistory() {
    this.history.push(JSON.stringify({
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      walls: this.walls
    }));
    if (this.history.length > 40) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.history.length) return;
    this.redoStack.push(JSON.stringify({
      lines: this.lines,
      markers: this.markers,
      paths: this.paths,
      walls: this.walls
    }));
    const prev = JSON.parse(this.history.pop());
    this.lines = prev.lines || [];
    this.markers = prev.markers || [];
    this.paths = prev.paths || [];
    this.walls = prev.walls || [];
    this.selectedLineIdx = -1;
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
      walls: this.walls
    }));
    const next = JSON.parse(this.redoStack.pop());
    this.lines = next.lines || [];
    this.markers = next.markers || [];
    this.paths = next.paths || [];
    this.walls = next.walls || [];
    this.render();
    this.triggerSave();
  }

  triggerSave() {
    if (this.onSave) {
      this.onSave({
        lines: this.lines,
        markers: this.markers,
        paths: this.paths,
        walls: this.walls
      });
    }
  }

  initUI() {
    this.container.innerHTML = `
      <div class="mc-wrapper" style="background:#111827; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; user-select:none;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:#1F2937; border-bottom:1px solid #374151; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; align-items:center; gap:6px;">
            ${this.colors.map(c => `
              <button type="button" class="mc-color-btn" data-color="${c}"
                      style="width:22px; height:22px; border-radius:50%; background:${c}; border:${c === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280"}; cursor:pointer;"></button>
            `).join("")}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" id="mc-fit" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">重置視角</button>
            <button type="button" id="mc-undo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">↩ 復原</button>
            <button type="button" id="mc-redo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">↪ 重做</button>
          </div>
        </div>

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

        <div id="mc-viewport" style="position:relative; width:100%; height:64vh; min-height:380px; background:#0F172A; overflow:hidden; touch-action:none;">
          <canvas id="mc-canvas" style="display:block; width:100%; height:100%;"></canvas>

          <div id="mc-keypad" class="hidden" style="position:absolute; top:10px; right:10px; width:235px; background:rgba(255,255,255,0.97); border:1.5px solid #111827; border-radius:8px; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.35); z-index:20;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span id="mc-kp-title" style="font-size:11px; font-weight:700; color:#374151;">輸入尺寸 (mm)</span>
              <button type="button" id="mc-kp-close" style="border:none; background:none; font-size:15px; cursor:pointer; color:#6B7280;">✕</button>
            </div>
            <div id="mc-kp-segs" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;"></div>
            <div id="mc-kp-display" style="background:#F3F4F6; border:1px solid #9CA3AF; border-radius:4px; padding:6px 8px; font-size:18px; font-weight:800; text-align:right; color:#111827; margin-bottom:6px; min-height:34px;">0</div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; margin-bottom:5px;">
              ${["7","8","9","4","5","6","1","2","3","0","00","⌫"].map(k => `
                <button type="button" class="mc-kp-key" data-key="${k}" style="padding:7px 0; font-size:15px; font-weight:700; background:#FFF; border:1px solid #CBD5E1; border-radius:4px; cursor:pointer;">${k}</button>
              `).join("")}
            </div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px;">
              <button type="button" class="mc-kp-adj" data-adj="-5" style="padding:5px 0; font-size:12px; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; border-radius:4px; cursor:pointer;">-5</button>
              <button type="button" class="mc-kp-adj" data-adj="-7" style="padding:5px 0; font-size:12px; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; border-radius:4px; cursor:pointer;">-7</button>
              <button type="button" class="mc-kp-adj" data-adj="-10" style="padding:5px 0; font-size:12px; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; border-radius:4px; cursor:pointer;">-10</button>
              <button type="button" id="mc-kp-ok" style="padding:5px 0; font-size:12px; font-weight:700; background:#111827; color:#FFF; border:none; border-radius:4px; cursor:pointer;">確定</button>
            </div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-around; align-items:center; padding:6px 8px; background:#1F2937; border-top:1px solid #374151; flex-wrap:wrap; gap:4px;">
          ${[
            { id: "PAN", label: "✋ 瀏覽縮放" },
            { id: "RULER", label: "📏 拉尺線" },
            { id: "CHAIN", label: "🔗 分段拉尺" },
            { id: "PEN", label: "✏️ 手繪畫筆" },
            { id: "STAMP", label: "🔖 印章庫" },
            { id: "TEXT", label: "🔤 文字" },
            { id: "ERASER", label: "🧹 擦除" }
          ].map(t => `
            <button type="button" class="mc-tool-btn" data-tool="${t.id}"
                    style="padding:5px 9px; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer; border:1px solid ${t.id === this.tool ? "#FFF" : "#4B5563"}; background:${t.id === this.tool ? "#2563EB" : "#374151"}; color:#FFF;">
              ${t.label}
            </button>
          `).join("")}
        </div>
      </div>
    `;

    this.viewport = document.getElementById("mc-viewport");
    this.canvas = document.getElementById("mc-canvas");
    this.ctx = this.canvas.getContext("2d");

    this.bindToolbarEvents();
    this.bindPointerEvents();
    window.addEventListener("resize", () => this.render());
  }

  bindToolbarEvents() {
    this.container.querySelectorAll(".mc-color-btn").forEach(btn => {
      btn.onclick = () => {
        this.activeColor = btn.dataset.color;
        this.container.querySelectorAll(".mc-color-btn").forEach(b => {
          b.style.border = b.dataset.color === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280";
        });
      };
    });

    this.container.querySelectorAll(".mc-tool-btn").forEach(btn => {
      btn.onclick = () => {
        this.tool = btn.dataset.tool;
        this.container.querySelectorAll(".mc-tool-btn").forEach(b => {
          const active = b.dataset.tool === this.tool;
          b.style.background = active ? "#2563EB" : "#374151";
          b.style.borderColor = active ? "#FFF" : "#4B5563";
        });
        const drawer = document.getElementById("mc-stamp-drawer");
        if (this.tool === "STAMP") drawer.classList.remove("hidden");
        else drawer.classList.add("hidden");
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
    this.selectedLineIdx = lineIdx;
    this.activeSegIdx = segIdx;
    const line = this.lines[lineIdx];
    if (!line) return;

    const kp = document.getElementById("mc-keypad");
    const segsBox = document.getElementById("mc-kp-segs");
    kp.classList.remove("hidden");

    if (Array.isArray(line.chainSegs) && line.chainSegs.length > 0) {
      if (segIdx < 0) this.activeSegIdx = 0;
      document.getElementById("mc-kp-title").textContent = `分段尺寸 (共${line.chainSegs.length}段)`;
      segsBox.innerHTML = line.chainSegs.map((s, idx) => `
        <button type="button" class="chip ${idx === this.activeSegIdx ? "active" : ""}" data-seg="${idx}">
          段${idx + 1}: ${s.val || 0}
        </button>
      `).join("") + `<button type="button" id="mc-add-seg" class="chip" style="border-color:#2563EB; color:#2563EB;">+分段</button>`;

      segsBox.querySelectorAll("[data-seg]").forEach(b => {
        b.onclick = () => this.openKeypad(lineIdx, Number(b.dataset.seg));
      });
      document.getElementById("mc-add-seg").onclick = () => {
        this.pushHistory();
        line.chainSegs.push({ val: 0 });
        this.openKeypad(lineIdx, line.chainSegs.length - 1);
        this.render();
      };
      this.keypadVal = String(line.chainSegs[this.activeSegIdx]?.val || "");
    } else {
      document.getElementById("mc-kp-title").textContent = "輸入尺寸 (mm)";
      segsBox.innerHTML = `<button type="button" id="mc-to-chain" class="chip" style="color:#2563EB; border-color:#2563EB;">轉為多段連續拉尺</button>`;
      document.getElementById("mc-to-chain").onclick = () => {
        this.pushHistory();
        const curNum = parseFloat(String(line.text || line.label || "").replace(/[^\d.]/g, "")) || 0;
        line.chainSegs = [{ val: curNum }, { val: 0 }];
        this.openKeypad(lineIdx, 1);
        this.render();
      };
      this.keypadVal = String(line.text || line.label || "").replace(/[^\d.]/g, "");
    }

    document.getElementById("mc-kp-display").textContent = this.keypadVal || "0";
  }

  commitKeypadValue() {
    const line = this.lines[this.selectedLineIdx];
    if (!line) return;
    this.pushHistory();
    const num = Number(this.keypadVal || 0);
    if (Array.isArray(line.chainSegs) && line.chainSegs.length > 0 && this.activeSegIdx >= 0) {
      line.chainSegs[this.activeSegIdx].val = num;
      const total = line.chainSegs.reduce((sum, s) => sum + (Number(s.val) || 0), 0);
      line.text = String(total);
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
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale
    };
  }

  bindPointerEvents() {
    let isDown = false;
    let startPt = null;
    let draftLine = null;
    let draftPath = null;
    let panStart = null;
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
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      startPt = imgPt;

      if (this.tool === "PAN") {
        panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        const hitLine = this.findNearestLine(imgPt);
        if (hitLine !== -1) this.openKeypad(hitLine);
      } else if (this.tool === "RULER" || this.tool === "CHAIN") {
        draftLine = {
          x1: imgPt.x,
          y1: imgPt.y,
          x2: imgPt.x,
          y2: imgPt.y,
          color: this.activeColor,
          text: "",
          chainSegs: this.tool === "CHAIN" ? [{ val: 0 }, { val: 0 }] : null
        };
      } else if (this.tool === "PEN") {
        draftPath = {
          color: this.activeColor,
          width: Math.max(3, this.natW / 320),
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
      if (this.tool === "PAN" && panStart) {
        this.offsetX = e.clientX - panStart.x;
        this.offsetY = e.clientY - panStart.y;
        this.render();
      } else if (draftLine) {
        const imgPt = this.screenToImg(e.clientX, e.clientY);
        const dx = imgPt.x - startPt.x;
        const dy = imgPt.y - startPt.y;
        if (Math.abs(dy) < Math.abs(dx) * 0.08) {
          draftLine.x2 = imgPt.x;
          draftLine.y2 = startPt.y;
        } else if (Math.abs(dx) < Math.abs(dy) * 0.08) {
          draftLine.x2 = startPt.x;
          draftLine.y2 = imgPt.y;
        } else {
          draftLine.x2 = imgPt.x;
          draftLine.y2 = imgPt.y;
        }
        this.render(draftLine, null);
      } else if (draftPath) {
        const imgPt = this.screenToImg(e.clientX, e.clientY);
        draftPath.points.push({ x: imgPt.x, y: imgPt.y });
        this.render(null, draftPath);
      } else if (this.tool === "ERASER") {
        this.eraseAt(this.screenToImg(e.clientX, e.clientY));
      }
    });

    const endPointer = (e) => {
      activePointers.delete(e.pointerId);
      if (draftLine) {
        const len = Math.hypot(draftLine.x2 - draftLine.x1, draftLine.y2 - draftLine.y1);
        if (len > 15 / this.scale) {
          this.pushHistory();
          this.lines.push(draftLine);
          const newIdx = this.lines.length - 1;
          this.render();
          this.triggerSave();
          this.openKeypad(newIdx);
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

  findNearestLine(pt) {
    const tol = 22 / this.scale;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      const mx = (l.x1 + l.x2) / 2;
      const my = (l.y1 + l.y2) / 2;
      if (Math.hypot(pt.x - mx, pt.y - my) < tol * 1.6) return i;
    }
    return -1;
  }

  eraseAt(pt) {
    const tol = 24 / this.scale;
    const mIdx = this.markers.findIndex(m => Math.hypot(m.x - pt.x, m.y - pt.y) < tol);
    if (mIdx !== -1) {
      this.pushHistory();
      this.markers.splice(mIdx, 1);
      this.render();
      this.triggerSave();
      return;
    }
    const lIdx = this.findNearestLine(pt);
    if (lIdx !== -1) {
      this.pushHistory();
      this.lines.splice(lIdx, 1);
      this.render();
      this.triggerSave();
      return;
    }
    const pIdx = this.paths.findIndex(p => {
      const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
      return pts.some(node => {
        const nx = Array.isArray(node) ? node[0] : node.x;
        const ny = Array.isArray(node) ? node[1] : node.y;
        return Math.hypot(nx - pt.x, ny - pt.y) < tol;
      });
    });
    if (pIdx !== -1) {
      this.pushHistory();
      this.paths.splice(pIdx, 1);
      this.render();
      this.triggerSave();
    }
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

    // 1. 繪製舊手繪筆跡與新增手繪線條
    const allPaths = draftPath ? [...this.paths, draftPath] : this.paths;
    allPaths.forEach(p => this.drawFreehandPath(ctx, p));

    // 2. 繪製牆身線
    this.walls.forEach(w => {
      ctx.save();
      ctx.strokeStyle = w.color || "#111827";
      ctx.lineWidth = Math.max(4, this.natW / 240);
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
      ctx.restore();
    });

    // 3. 繪製拉尺線（支援虛線尺 dashed 與實線尺）
    const allLines = draftLine ? [...this.lines, draftLine] : this.lines;
    allLines.forEach((l, idx) => this.drawRulerLine(ctx, l, idx === this.selectedLineIdx));

    // 4. 繪製印章與文字標註
    this.markers.forEach(m => this.drawMarker(ctx, m));

    ctx.restore();
  }

  drawFreehandPath(ctx, p) {
    const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = p.color || "#111827";
    ctx.lineWidth = p.width || p.size || Math.max(3, this.natW / 320);
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

  drawRulerLine(ctx, l, isSelected) {
    const color = l.color || "#2563EB";
    const lw = Math.max(2.5, (this.natW / 420));
    const headLen = lw * 4.2;
    const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);

    ctx.save();
    ctx.strokeStyle = isSelected ? "#FACC15" : color;
    ctx.fillStyle = color;
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
      ctx.lineTo(x + headLen * Math.cos(ang + 0.42), y + headLen * Math.sin(ang + 0.42));
      ctx.moveTo(x, y);
      ctx.lineTo(x + headLen * Math.cos(ang - 0.42), y + headLen * Math.sin(ang - 0.42));
      ctx.stroke();
    };
    drawEnd(l.x1, l.y1, angle);
    drawEnd(l.x2, l.y2, angle + Math.PI);

    let label = l.text ? String(l.text) : (l.label ? String(l.label) : "");
    if (Array.isArray(l.chainSegs) && l.chainSegs.length > 0) {
      const segText = l.chainSegs.map(s => s.val || 0).join("+");
      const total = lineTotal(l.chainSegs);
      label = `${segText} = ${total}`;
    }

    if (label) {
      const mx = (l.x1 + l.x2) / 2;
      const my = (l.y1 + l.y2) / 2;
      const fontSize = Math.max(16, Math.round(this.natW / 42));
      ctx.font = `800 ${fontSize}px -apple-system, sans-serif`;
      const metrics = ctx.measureText(label);
      const padX = fontSize * 0.45;
      const padY = fontSize * 0.3;
      const boxW = metrics.width + padX * 2;
      const boxH = fontSize + padY * 2;

      ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, lw * 0.6);
      ctx.beginPath();
      ctx.roundRect(mx - boxW / 2, my - boxH / 2, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my);
    }

    ctx.restore();
  }

  drawMarker(ctx, m) {
    const text = m.text || m.label || m.val || "";
    if (!text) return;
    const color = m.color || "#2563EB";
    const fontSize = Math.max(15, Math.round(this.natW / 46));

    ctx.save();
    ctx.font = `700 ${fontSize}px -apple-system, sans-serif`;
    const metrics = ctx.measureText(text);
    const padX = fontSize * 0.5;
    const padY = fontSize * 0.32;
    const w = metrics.width + padX * 2;
    const h = fontSize + padY * 2;

    const isFilledStamp = m.isStamp === true;
    ctx.fillStyle = isFilledStamp ? color : "rgba(255,255,255,0.94)";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, this.natW / 500);
    ctx.beginPath();
    ctx.roundRect(m.x - w / 2, m.y - h / 2, w, h, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isFilledStamp ? "#FFFFFF" : color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, m.x, m.y);
    ctx.restore();
  }
}

function lineTotal(segs) {
  return segs.reduce((a, b) => a + (Number(b.val) || 0), 0);
}

    this.isDrawing = false;
    this.startPt = null;
    this.tempEndPt = null;
    this.draggingLabelId = null;

    this.renderShell();
    this.bindEvents();
  }

  renderShell() {
    const swatchesHtml = this.colors.map(c => `
      <button type="button" class="swatch-btn ${c.hex === this.activeColor ? "selected" : ""}"
              data-hex="${c.hex}" title="${c.name}" style="background:${c.hex};"></button>
    `).join("");

    this.container.innerHTML = `
      <div class="card" style="padding:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
          <div class="swatch-bar">
            <span style="font-size:12px; font-weight:700; color:#4B5563;">尺線顏色：</span>
            ${swatchesHtml}
          </div>
          <span style="font-size:12px; color:#4B5563;">手指拖曳畫線 · 點標籤改尺寸/納入報告</span>
        </div>

        <div id="mc-stage" style="position:relative; width:100%; overflow:hidden; border:1px solid #111827; border-radius:4px; background:#000; touch-action:none;">
          <img id="mc-img" src="${this.imageUrl}" style="display:block; width:100%; height:auto; pointer-events:none;" />
          <svg id="mc-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"
               style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;"></svg>
          <div id="mc-labels" style="position:absolute; inset:0;"></div>
        </div>

        <div id="mc-inspector" class="hidden" style="margin-top:10px; padding:10px; background:#F9FAFB; border:1px solid #D1D5DB; border-radius:4px;">
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between;">
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="text" id="mc-val-input" placeholder="輸入尺寸 (如 2450mm)"
                     style="width:140px; padding:6px 8px; border:1px solid #111827; border-radius:4px; font-weight:700;" />
              <input type="text" id="mc-note-input" placeholder="備註 (如 樑底高)"
                     style="width:130px; padding:6px 8px; border:1px solid #D1D5DB; border-radius:4px;" />
            </div>
            <label style="display:flex; align-items:center; gap:5px; font-weight:700; font-size:14px; cursor:pointer;">
              <input type="checkbox" id="mc-report-chk" style="width:18px; height:18px; accent-color:#111827;" />
              <span>納入報告</span>
            </label>
            <button type="button" id="mc-del-btn" class="btn-outline btn-sm" style="color:#DC2626; border-color:#DC2626;">刪除</button>
          </div>
        </div>
      </div>
    `;
    this.redraw();
  }

  getRelCoords(e) {
    const stage = this.container.querySelector("#mc-stage");
    const rect = stage.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min(1000, Math.round(((clientX - rect.left) / rect.width) * 1000))),
      y: Math.max(0, Math.min(1000, Math.round(((clientY - rect.top) / rect.height) * 1000)))
    };
  }

  bindEvents() {
    this.container.querySelectorAll(".swatch-btn").forEach(btn => {
      btn.onclick = () => {
        this.activeColor = btn.dataset.hex;
        this.container.querySelectorAll(".swatch-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        if (this.selectedLineId) {
          const line = this.lines.find(l => l.id === this.selectedLineId);
          if (line) { line.color = this.activeColor; this.notifyAndRedraw(); }
        }
      };
    });

    const stage = this.container.querySelector("#mc-stage");
    const startDraw = (e) => {
      if (e.target.classList.contains("dim-pill-label")) return;
      this.isDrawing = true;
      this.startPt = this.getRelCoords(e);
      this.tempEndPt = { ...this.startPt };
    };
    const moveDraw = (e) => {
      if (this.draggingLabelId) {
        e.preventDefault();
        const pt = this.getRelCoords(e);
        const line = this.lines.find(l => l.id === this.draggingLabelId);
        if (line) { line.lx = pt.x; line.ly = pt.y; this.redraw(); }
        return;
      }
      if (!this.isDrawing) return;
      e.preventDefault();
      this.tempEndPt = this.getRelCoords(e);
      this.redraw();
    };
    const endDraw = () => {
      if (this.draggingLabelId) {
        this.draggingLabelId = null;
        this.notifyAndRedraw();
        return;
      }
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const dx = this.tempEndPt.x - this.startPt.x;
      const dy = this.tempEndPt.y - this.startPt.y;
      if (Math.hypot(dx, dy) > 25) {
        const newLine = {
          id: "L_" + Date.now(),
          x1: this.startPt.x, y1: this.startPt.y,
          x2: this.tempEndPt.x, y2: this.tempEndPt.y,
          lx: Math.round((this.startPt.x + this.tempEndPt.x) / 2),
          ly: Math.round((this.startPt.y + this.tempEndPt.y) / 2),
          color: this.activeColor,
          value: "0 mm",
          note: "",
          includeInReport: false
        };
        this.lines.push(newLine);
        this.selectLine(newLine.id);
        this.notifyAndRedraw();
      } else {
        this.redraw();
      }
    };

    stage.addEventListener("mousedown", startDraw);
    window.addEventListener("mousemove", moveDraw);
    window.addEventListener("mouseup", endDraw);
    stage.addEventListener("touchstart", startDraw, { passive: false });
    window.addEventListener("touchmove", moveDraw, { passive: false });
    window.addEventListener("touchend", endDraw);

    this.container.querySelector("#mc-val-input").oninput = (e) => {
      const l = this.lines.find(item => item.id === this.selectedLineId);
      if (l) { l.value = e.target.value; this.notifyAndRedraw(); }
    };
    this.container.querySelector("#mc-note-input").oninput = (e) => {
      const l = this.lines.find(item => item.id === this.selectedLineId);
      if (l) { l.note = e.target.value; this.notifyAndRedraw(); }
    };
    this.container.querySelector("#mc-report-chk").onchange = (e) => {
      const l = this.lines.find(item => item.id === this.selectedLineId);
      if (l) { l.includeInReport = e.target.checked; this.notifyAndRedraw(); }
    };
    this.container.querySelector("#mc-del-btn").onclick = () => {
      this.lines = this.lines.filter(item => item.id !== this.selectedLineId);
      this.selectedLineId = null;
      this.container.querySelector("#mc-inspector").classList.add("hidden");
      this.notifyAndRedraw();
    };
  }

  selectLine(id) {
    this.selectedLineId = id;
    const line = this.lines.find(l => l.id === id);
    const insp = this.container.querySelector("#mc-inspector");
    if (!line) { insp.classList.add("hidden"); return; }
    insp.classList.remove("hidden");
    this.container.querySelector("#mc-val-input").value = line.value;
    this.container.querySelector("#mc-note-input").value = line.note || "";
    this.container.querySelector("#mc-report-chk").checked = !!line.includeInReport;
  }

  redraw() {
    const svg = this.container.querySelector("#mc-svg");
    const labelsBox = this.container.querySelector("#mc-labels");
    let reportIdx = 0;

    const allLines = [...this.lines];
    if (this.isDrawing && this.startPt && this.tempEndPt) {
      allLines.push({
        id: "TEMP", x1: this.startPt.x, y1: this.startPt.y,
        x2: this.tempEndPt.x, y2: this.tempEndPt.y, color: this.activeColor
      });
    }

    svg.innerHTML = allLines.map(l => `
      <g>
        <line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"
              stroke="${l.color}" stroke-width="${l.id === this.selectedLineId ? 6 : 4}" />
        <circle cx="${l.x1}" cy="${l.y1}" r="7" fill="${l.color}" />
        <circle cx="${l.x2}" cy="${l.y2}" r="7" fill="${l.color}" />
      </g>
    `).join("");

    labelsBox.innerHTML = this.lines.map(l => {
      const badge = l.includeInReport ? `<span class="dim-report-badge">#${++reportIdx}</span>` : "";
      const outline = l.id === this.selectedLineId ? "box-shadow: 0 0 0 2px #111827;" : "";
      return `
        <div class="dim-pill-label" data-id="${l.id}"
             style="left:${l.lx / 10}%; top:${l.ly / 10}%; color:${l.color}; ${outline}">
          ${l.value || "未填"}${badge}
        </div>
      `;
    }).join("");

    labelsBox.querySelectorAll(".dim-pill-label").forEach(el => {
      const startDragLabel = (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        this.selectLine(id);
        this.draggingLabelId = id;
        this.redraw();
      };
      el.addEventListener("mousedown", startDragLabel);
      el.addEventListener("touchstart", startDragLabel, { passive: true });
    });
  }

  notifyAndRedraw() {
    this.redraw();
    if (this.onChange) this.onChange(this.lines);
  }
}
