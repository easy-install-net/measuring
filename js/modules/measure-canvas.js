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
    this.onChange = onChange;

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
