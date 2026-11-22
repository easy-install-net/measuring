export const DEFAULT_CHECKLIST_PHRASES = [
  { cat: "搬運收口", text: "⚠️ 超出2300mm電梯上限，必須標註分件接駁" },
  { cat: "搬運收口", text: "⚠️ 核對大廈後樓梯轉角能否搬運" },
  { cat: "搬運收口", text: "⚠️ 兩牆之間做死數(0mm)，確認現場垂直度" },
  { cat: "搬運收口", text: "⚠️ 頂部無留20mm收口條，天花不平會出現大小縫" },
  { cat: "搬運收口", text: "⚠️ 貼牆櫃背需切15×100mm缺口避原裝地腳線" },
  { cat: "搬運收口", text: "⚠️ 踢腳高度需拉平全屋統一地腳線" },
  { cat: "搬運收口", text: "⚠️ 走廊剩餘通道<750mm，影響通行及搬運" },
  { cat: "搬運收口", text: "⚠️ 懸空櫃離地50-100mm尷尬位，掃地機進不去" },
  { cat: "搬運收口", text: "🚨 石膏板/空心牆無法直接掛重型吊櫃" },
  { cat: "搬運收口", text: "⚠️ 櫃體撞陣柱，需做切角或降高避讓" },
  { cat: "門窗碰撞", text: "🚨 趟門衣櫃總深不足580mm，扣除路軌掛衫關不上門" },
  { cat: "門窗碰撞", text: "⚠️ 掩門高>2000mm易彎曲，需加裝暗藏拉直器" },
  { cat: "門窗碰撞", text: "⚠️ 拍門器需留足3mm回彈縫否則彈不出" },
  { cat: "門窗碰撞", text: "🚨 掩門內抽側板需加25mm墊厚條避門鉸" },
  { cat: "門窗碰撞", text: "🚨 L型轉角兩門相交需加40×40mm收口柱防互撞" },
  { cat: "門窗碰撞", text: "⚠️ 靠床掩門下段會撞床頭櫃，建議改上下分段門" },
  { cat: "門窗碰撞", text: "🚨 油壓床板向上揭起時會撞到吸頂燈或冷氣機" },
  { cat: "門窗碰撞", text: "⚠️ 玄關鞋櫃距大門框<120mm，開門門鎖會撞側板" },
  { cat: "門窗碰撞", text: "⚠️ 書枱/餐櫃後方淨空<750mm，椅子無法拉出轉身" },
  { cat: "門窗碰撞", text: "⚠️ 浴屏外開掩門打開時會撞到浴室櫃" },
  { cat: "水電冷氣", text: "🚨 插蘇位被固定層板/抽屜軌擋住無法插電" },
  { cat: "水電冷氣", text: "⚠️ 牆身燈掣被櫃身遮擋，需改位或開側板孔" },
  { cat: "水電冷氣", text: "⚠️ 電箱藏櫃內，內部層板必須做活動可拆" },
  { cat: "水電冷氣", text: "⚠️ 掛牆電視至地櫃需設50mm暗藏穿線管開孔" },
  { cat: "水電冷氣", text: "🚨 高櫃距分體冷氣頂<150mm，遮擋迴風會滴水" },
  { cat: "水電冷氣", text: "⚠️ 背板貼牆有冷氣去水喉，需開凹槽避讓防壓爆" },
  { cat: "水電冷氣", text: "🚨 LED燈帶火牛必須放活動層板或可拆蓋板內檢修" },
  { cat: "水電冷氣", text: "🚨 高櫃頂距消防花灑頭<500mm，違反安全距離" },
  { cat: "水電冷氣", text: "🚨 煤氣櫃門必須設通風百葉孔及檢修空間" },
  { cat: "水電冷氣", text: "⚠️ 床褥或軟包高度會遮擋牆身床頭充電插蘇" },
  { cat: "廚浴電器", text: "🚨 雪櫃左右及頂部各需留30mm散熱縫" },
  { cat: "廚浴電器", text: "🚨 雪櫃貼牆側需留≥50mm門縫收口才能開90°門" },
  { cat: "廚浴電器", text: "🚨 焗爐/蒸焗爐櫃身淨深需≥電器深度+60mm" },
  { cat: "廚浴電器", text: "🚨 洗衣機櫃淨深需≥機身深度+80mm容納來去水喉" },
  { cat: "廚浴電器", text: "⚠️ 抽油煙機吊櫃頂需設假身包管遮擋排氣喉" },
  { cat: "廚浴電器", text: "🚨 內開廚房窗打開會撞到星盆高身水龍頭" },
  { cat: "廚浴電器", text: "🚨 星盆櫃層板需預留U型去水隔氣喉缺口" },
  { cat: "廚浴電器", text: "🚨 廚櫃星盆櫃/浴室櫃潮濕區必須用防水夾板" },
  { cat: "廚浴電器", text: "🚨 浴室櫃不可木板直接落地，需離地≥250mm或防水腳" },
  { cat: "廚浴電器", text: "⚠️ 鏡櫃底距洗手盆面<350mm，外開掩門會撞龍頭" }
];

const BUILTIN_STAMPS = [
  { label: "❌ 需修改", bg: "#DC2626", color: "#FFFFFF", status: "NEED_FIX" },
  { label: "⚠️ 現場核對", bg: "#D97706", color: "#FFFFFF", status: "SITE_CHECK" },
  { label: "📌 待補資料", bg: "#2563EB", color: "#FFFFFF", status: "NEED_INFO" },
  { label: "✅ 確認無誤", bg: "#059669", color: "#FFFFFF", status: "OK" }
];

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, colors, onChange, navOpts = {}) {
    this.container = container;
    this.imageUrl = imageUrl;
    this.lines = Array.isArray(initialData?.lines) ? initialData.lines : [];
    this.markers = Array.isArray(initialData?.markers) ? initialData.markers : [];
    this.paths = Array.isArray(initialData?.paths) ? initialData.paths : [];
    this.arrows = Array.isArray(initialData?.arrows) ? initialData.arrows : [];
    this.stickers = Array.isArray(initialData?.stickers) ? initialData.stickers : [];
    this.colors = Array.isArray(colors) && colors.length ? colors : ["#111827", "#2563EB", "#059669", "#9333EA", "#DC2626", "#EA580C", "#EAB308", "#FFFFFF"];
    this.onChange = onChange;
    this.navOpts = navOpts;

    this.mode = "SELECT"; // SELECT | RULER | ARROW | PEN | TEXT | STAMP | ERASER
    this.activeColor = this.colors[4] || "#DC2626";
    this.strokeWidth = 1.5; // 支援極幼細 0.5px ~ 8px，且只套用於新畫或單選項目
    this.fontSize = 18;
    this.whiteBg = false;
    this.selectedItem = null; // { type: 'line'|'marker'|'path'|'arrow'|'sticker', index }

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
    if (typeof this.navOpts.getPhraseBank === "function") {
      return this.navOpts.getPhraseBank();
    }
    return DEFAULT_CHECKLIST_PHRASES;
  }

  buildDOM() {
    this.container.innerHTML = `
      <div class="mc-root" style="position:relative; width:100%; height:100%; background:#F8FAFC; overflow:hidden; user-select:none; touch-action:none;">
        <!-- 滿版無黑邊畫布 -->
        <canvas class="mc-canvas" style="display:block; width:100%; height:100%; background:#F8FAFC;"></canvas>

        <!-- 頂部精簡浮動工具列（支援極幼細 0.5px 畫筆，且不全域修改舊線條） -->
        <div class="mc-topbar" style="position:absolute; top:8px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:5px; padding:4px 9px; background:rgba(255,255,255,0.96); border:1px solid #CBD5E1; border-radius:999px; box-shadow:0 4px 14px rgba(15,23,42,0.1); z-index:20; max-width:96vw; overflow-x:auto;">
          <button class="mc-tool-btn active" data-mode="SELECT" title="選取/移動/雙擊改字">✋ 選取</button>
          <button class="mc-tool-btn" data-mode="ARROW" title="拉箭頭指示線放手即打字" style="color:#DC2626; font-weight:800;">↗ 箭頭</button>
          <button class="mc-tool-btn" data-mode="RULER" title="拉尺寸線">📏 拉尺</button>
          <button class="mc-tool-btn" data-mode="PEN" title="自由手繪（支援極幼線）">✏️ 畫筆</button>
          <button class="mc-tool-btn" data-mode="TEXT" title="點擊放置獨立文字">🔤 文字</button>
          <button class="mc-tool-btn" data-mode="STAMP" title="蓋狀態印章">🏷️ 印章</button>
          <button class="mc-tool-btn" data-mode="ERASER" title="點擊擦除單項">🧽 擦除</button>

          <span style="color:#E2E8F0;">|</span>

          <!-- 顏色點 -->
          <div style="display:flex; align-items:center; gap:3px;">
            ${this.colors.map(c => `
              <button class="mc-color-dot" data-color="${c}"
                      style="width:16px; height:16px; border-radius:50%; background:${c}; border:${c === this.activeColor ? "2.5px solid #0F172A" : "1px solid #94A3B8"}; cursor:pointer; padding:0; flex-shrink:0;"></button>
            `).join("")}
          </div>

          <span style="color:#E2E8F0;">|</span>

          <!-- 局部新線粗幼（0.5px 極幼 ~ 8px，僅套用於新線或當前選中線條） -->
          <label style="display:flex; align-items:center; gap:3px; font-size:11px; color:#334155; white-space:nowrap;">
            <span>幼細</span>
            <input type="range" class="mc-stroke-slider" min="0.5" max="8" step="0.5" value="${this.strokeWidth}" style="width:54px; accent-color:#2563EB;" />
            <span class="mc-stroke-val" style="min-width:24px; font-weight:700;">${this.strokeWidth}</span>
          </label>

          <button class="mc-reset-zoom" title="重置縮放置中" style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:999px; padding:2px 7px; font-size:11px; color:#334155; cursor:pointer; white-space:nowrap;">⊡ 置中</button>
        </div>

        <!-- 印章快捷選單（選 STAMP 模式時浮出） -->
        <div class="mc-stamp-bar hidden" style="position:absolute; top:48px; left:50%; transform:translateX(-50%); display:flex; gap:5px; padding:5px 8px; background:#FFF; border:1px solid #CBD5E1; border-radius:999px; box-shadow:0 4px 12px rgba(0,0,0,0.12); z-index:22;">
          ${BUILTIN_STAMPS.map((st, idx) => `
            <button class="mc-stamp-pick" data-sidx="${idx}"
                    style="background:${st.bg}; color:${st.color}; border:none; border-radius:999px; padding:3px 9px; font-size:11px; font-weight:800; cursor:pointer;">
              ${st.label}
            </button>
          `).join("")}
        </div>

        <!-- 就近跟隨的選字／選線浮動條（緊貼選中物件下方顯示，不跑去螢幕最底） -->
        <div class="mc-near-toolbar hidden" style="position:absolute; display:flex; align-items:center; gap:6px; padding:5px 9px; background:rgba(15,23,42,0.94); color:#FFF; border-radius:999px; box-shadow:0 6px 18px rgba(0,0,0,0.28); z-index:35; white-space:nowrap;">
          <span class="mc-near-label" style="font-size:11px; color:#CBD5E1;">大小</span>
          <input type="range" class="mc-near-slider" min="0.5" max="48" step="0.5" value="18" style="width:74px; accent-color:#38BDF8;" />
          <button class="mc-near-edit" style="background:#334155; color:#FFF; border:none; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:700; cursor:pointer;">✏️ 改字</button>
          <button class="mc-near-del" style="background:#EF4444; color:#FFF; border:none; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:700; cursor:pointer;">🗑️ 刪除</button>
        </div>

        <!-- 就近打字彈出框（用於 ↗ 箭頭放手即打字 / 雙擊改字 / 放置文字，附 40 條分類短語庫與管理） -->
        <div class="mc-inline-box hidden" style="position:absolute; width:min(330px, 92vw); background:#FFF; border:2px solid #2563EB; border-radius:10px; padding:8px; box-shadow:0 12px 28px rgba(15,23,42,0.25); z-index:45; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong class="mc-inline-title" style="font-size:12px; color:#1E3A8A;">↗ 輸入批改或尺寸說明</strong>
            <div style="display:flex; gap:4px; align-items:center;">
              <select class="mc-inline-status" style="font-size:11px; padding:2px 4px; border:1px solid #CBD5E1; border-radius:4px; font-weight:700;">
                <option value="NEED_FIX">❌ 需修改</option>
                <option value="SITE_CHECK">⚠️ 現場核對</option>
                <option value="NEED_INFO">📌 待補資料</option>
                <option value="OK">✅ 確認無誤</option>
              </select>
              <button type="button" class="mc-manage-phrase-btn" style="background:#F1F5F9; border:1px solid #CBD5E1; border-radius:4px; padding:2px 5px; font-size:10px; cursor:pointer;">⚙️ 短語</button>
            </div>
          </div>

          <textarea class="mc-inline-input" rows="2" placeholder="輸入文字或點下方分類短語一鍵帶入..."
                    style="width:100%; box-sizing:border-box; padding:6px 8px; border:1.5px solid #93C5FD; border-radius:6px; font-size:13px; resize:vertical; font-family:inherit;"></textarea>

          <!-- 40 條現成短語分類切換 -->
          <div style="display:flex; flex-wrap:wrap; gap:3px;" class="mc-phrase-cats"></div>
          <div style="max-height:110px; overflow-y:auto; display:flex; flex-direction:column; gap:3px; background:#F8FAFC; padding:4px; border-radius:5px; border:1px solid #E2E8F0;" class="mc-phrase-items"></div>

          <div style="display:flex; justify-content:flex-end; gap:6px;">
            <button type="button" class="mc-inline-cancel" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:5px; padding:4px 10px; font-size:12px; cursor:pointer;">取消</button>
            <button type="button" class="mc-inline-ok" style="background:#2563EB; color:#FFF; border:none; border-radius:5px; padding:4px 12px; font-size:12px; font-weight:800; cursor:pointer;">確定貼上</button>
          </div>
        </div>

        <!-- 翻頁浮標（如有上下頁） -->
        ${this.navOpts.hasPrev ? `<button class="mc-nav-prev" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); background:rgba(255,255,255,0.9); border:1px solid #CBD5E1; border-radius:999px; width:34px; height:34px; font-size:16px; font-weight:800; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.12); z-index:18;">‹</button>` : ""}
        ${this.navOpts.hasNext ? `<button class="mc-nav-next" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:rgba(255,255,255,0.9); border:1px solid #CBD5E1; border-radius:999px; width:34px; height:34px; font-size:16px; font-weight:800; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.12); z-index:18;">›</button>` : ""}
      </div>
    `;

    this.rootEl = this.container.querySelector(".mc-root");
    this.canvas = this.container.querySelector(".mc-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.nearToolbar = this.container.querySelector(".mc-near-toolbar");
    this.inlineBox = this.container.querySelector(".mc-inline-box");
    this.inlineInput = this.container.querySelector(".mc-inline-input");
    this.selectedStampIdx = 0;
    this.activePhraseCat = "全部";
    this.pendingInlineAction = null;

    const styleTag = document.createElement("style");
    styleTag.textContent = `
      .mc-tool-btn { background:transparent; border:1px solid transparent; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap; }
      .mc-tool-btn.active { background:#EFF6FF; border-color:#3B82F6; color:#1D4ED8; }
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
    this.offsetX = (this.viewW - iw * s) / 2;
    this.offsetY = padTop + (availH - ih * s) / 2;
  }

  screenToImg(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale
    };
  }

  imgToScreen(ix, iy) {
    return {
      x: ix * this.scale + this.offsetX,
      y: iy * this.scale + this.offsetY
    };
  }

  toggleWhiteBackground() {
    this.whiteBg = !this.whiteBg;
    this.render();
    return this.whiteBg;
  }

  bindEvents() {
    this._onResize = () => this.resizeCanvas();
    window.addEventListener("resize", this._onResize);

    // 工具切換
    this.rootEl.querySelectorAll(".mc-tool-btn").forEach(btn => {
      btn.onclick = () => {
        this.rootEl.querySelectorAll(".mc-tool-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.mode = btn.dataset.mode;
        const stampBar = this.rootEl.querySelector(".mc-stamp-bar");
        if (this.mode === "STAMP") stampBar.classList.remove("hidden");
        else stampBar.classList.add("hidden");
        if (this.mode !== "SELECT") {
          this.selectedItem = null;
          this.updateNearToolbar();
        }
        this.render();
      };
    });

    // 印章選擇
    this.rootEl.querySelectorAll(".mc-stamp-pick").forEach(btn => {
      btn.onclick = () => {
        this.selectedStampIdx = Number(btn.dataset.sidx);
        this.rootEl.querySelectorAll(".mc-stamp-pick").forEach(b => b.style.outline = "none");
        btn.style.outline = "2px solid #0F172A";
      };
    });

    // 顏色選擇（僅套用於新畫或當前單選物件，絕不全域連動修改舊物件）
    this.rootEl.querySelectorAll(".mc-color-dot").forEach(dot => {
      dot.onclick = () => {
        this.activeColor = dot.dataset.color;
        this.rootEl.querySelectorAll(".mc-color-dot").forEach(d => {
          d.style.border = d.dataset.color === this.activeColor ? "2.5px solid #0F172A" : "1px solid #94A3B8";
        });
        if (this.selectedItem) {
          const obj = this.getSelectedObject();
          if (obj) {
            obj.color = this.activeColor;
            this.emitSave();
            this.render();
          }
        }
      };
    });

    // 局部粗幼滑桿（僅影響新線條或單獨選中的線條，不全域改舊線條）
    const strokeSlider = this.rootEl.querySelector(".mc-stroke-slider");
    const strokeVal = this.rootEl.querySelector(".mc-stroke-val");
    strokeSlider.oninput = () => {
      const val = parseFloat(strokeSlider.value);
      this.strokeWidth = val;
      strokeVal.textContent = String(val);
      if (this.selectedItem) {
        const obj = this.getSelectedObject();
        if (obj && (this.selectedItem.type === "path" || this.selectedItem.type === "line" || this.selectedItem.type === "arrow")) {
          obj.strokeWidth = val;
          this.render();
        }
      }
    };
    strokeSlider.onchange = () => {
      if (this.selectedItem) this.emitSave();
    };

    this.rootEl.querySelector(".mc-reset-zoom").onclick = () => {
      this.fitImageToScreen();
      this.updateNearToolbar();
      this.render();
    };

    const prevBtn = this.rootEl.querySelector(".mc-nav-prev");
    if (prevBtn && this.navOpts.onPrev) prevBtn.onclick = () => this.navOpts.onPrev();
    const nextBtn = this.rootEl.querySelector(".mc-nav-next");
    if (nextBtn && this.navOpts.onNext) nextBtn.onclick = () => this.navOpts.onNext();

    // 就近浮動條事件
    const nearSlider = this.nearToolbar.querySelector(".mc-near-slider");
    nearSlider.oninput = () => {
      const obj = this.getSelectedObject();
      if (!obj) return;
      const v = parseFloat(nearSlider.value);
      if (this.selectedItem.type === "marker" || this.selectedItem.type === "sticker" || this.selectedItem.type === "arrow") {
        obj.fontSize = v;
        this.fontSize = v;
      } else {
        obj.strokeWidth = v;
      }
      this.render();
    };
    nearSlider.onchange = () => this.emitSave();

    this.nearToolbar.querySelector(".mc-near-edit").onclick = () => {
      const obj = this.getSelectedObject();
      if (!obj) return;
      const anchor = this.getObjectAnchorImg(this.selectedItem.type, obj);
      const scr = this.imgToScreen(anchor.x, anchor.y);
      this.openInlineEditor(scr.x, scr.y, obj.text || obj.label || "", obj.status || "NEED_FIX", (newTxt, newStatus) => {
        if (this.selectedItem.type === "arrow") obj.text = newTxt;
        else if (this.selectedItem.type === "sticker") obj.label = newTxt;
        else obj.text = newTxt;
        obj.status = newStatus;
        this.emitSave(newTxt ? `[${this.formatStatusLabel(newStatus)}] ${newTxt}` : "");
        this.render();
      });
    };

    this.nearToolbar.querySelector(".mc-near-del").onclick = () => {
      if (!this.selectedItem) return;
      this.deleteObjectAt(this.selectedItem.type, this.selectedItem.index);
      this.selectedItem = null;
      this.updateNearToolbar();
      this.emitSave();
      this.render();
    };

    // 內嵌打字彈窗事件
    this.inlineBox.querySelector(".mc-inline-cancel").onclick = () => {
      this.inlineBox.classList.add("hidden");
      this.pendingInlineAction = null;
    };
    this.inlineBox.querySelector(".mc-inline-ok").onclick = () => this.commitInline(true);
    this.inlineBox.querySelector(".mc-manage-phrase-btn").onclick = () => {
      if (typeof this.navOpts.onOpenPhraseManager === "function") {
        this.navOpts.onOpenPhraseManager(() => this.renderInlinePhraseUI());
      }
    };

    // 畫布滑鼠與觸控操作
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoomAt(mx, my, factor);
    }, { passive: false });

    this.canvas.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.handlePointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.handlePointerUp(e));

    // 雙指縮放
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

    // 雙擊快速改字
    const now = Date.now();
    if (now - this.lastTapTime < 320 && this.lastTapPos && Math.hypot(sx - this.lastTapPos.x, sy - this.lastTapPos.y) < 22) {
      const hit = this.hitTest(pt.x, pt.y);
      if (hit && (hit.type === "marker" || hit.type === "arrow" || hit.type === "line" || hit.type === "sticker")) {
        this.selectedItem = hit;
        this.updateNearToolbar();
        const obj = this.getSelectedObject();
        this.openInlineEditor(sx, sy, obj.text || obj.label || "", obj.status || "NEED_FIX", (newTxt, newStatus) => {
          if (hit.type === "sticker") obj.label = newTxt;
          else obj.text = newTxt;
          obj.status = newStatus;
          this.emitSave(newTxt ? `[${this.formatStatusLabel(newStatus)}] ${newTxt}` : "");
          this.render();
        });
        this.lastTapTime = 0;
        return;
      }
    }
    this.lastTapTime = now;
    this.lastTapPos = { x: sx, y: sy };

    if (this.mode === "ERASER") {
      const hit = this.hitTest(pt.x, pt.y);
      if (hit) {
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
        this.dragTarget = { ...hit, startImg: pt, orig: JSON.parse(JSON.stringify(this.getSelectedObject())) };
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
      this.openInlineEditor(sx, sy, "", "NEED_FIX", (txt, status) => {
        if (!txt.trim()) return;
        this.markers.push({
          x: pt.x,
          y: pt.y,
          text: txt.trim(),
          color: this.activeColor,
          fontSize: this.fontSize,
          status
        });
        this.selectedItem = { type: "marker", index: this.markers.length - 1 };
        this.updateNearToolbar();
        this.emitSave(`[${this.formatStatusLabel(status)}] ${txt.trim()}`);
        this.render();
      });
      return;
    }

    if (this.mode === "STAMP") {
      const st = BUILTIN_STAMPS[this.selectedStampIdx] || BUILTIN_STAMPS[0];
      this.stickers.push({
        x: pt.x,
        y: pt.y,
        label: st.label,
        bg: st.bg,
        color: st.color,
        status: st.status,
        fontSize: 16
      });
      this.selectedItem = { type: "sticker", index: this.stickers.length - 1 };
      this.updateNearToolbar();
      this.emitSave(`${st.label}`);
      this.render();
      return;
    }

    if (this.mode === "ARROW") {
      this.isDrawing = true;
      this.draftObj = {
        type: "arrow",
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
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
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
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
      this.render();
      return;
    }

    const pt = this.screenToImg(sx, sy);

    if (this.dragTarget) {
      const dx = pt.x - this.dragTarget.startImg.x;
      const dy = pt.y - this.dragTarget.startImg.y;
      const obj = this.getSelectedObject();
      const orig = this.dragTarget.orig;
      if (obj && orig) {
        if (this.dragTarget.type === "marker" || this.dragTarget.type === "sticker") {
          obj.x = orig.x + dx;
          obj.y = orig.y + dy;
        } else if (this.dragTarget.type === "line" || this.dragTarget.type === "arrow") {
          obj.x1 = orig.x1 + dx;
          obj.y1 = orig.y1 + dy;
          obj.x2 = orig.x2 + dx;
          obj.y2 = orig.y2 + dy;
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
        this.draftObj.x2 = pt.x;
        this.draftObj.y2 = pt.y;
      } else if (this.draftObj.type === "path") {
        this.draftObj.points.push({ x: pt.x, y: pt.y });
      }
      this.render();
    }
  }

  handlePointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }
    if (this.dragTarget) {
      this.dragTarget = null;
      this.emitSave();
      return;
    }
    if (!this.isDrawing || !this.draftObj) return;
    this.isDrawing = false;
    const finished = this.draftObj;
    this.draftObj = null;

    if (finished.type === "arrow") {
      const dist = Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1);
      if (dist < 10) {
        this.render();
        return;
      }
      this.arrows.push(finished);
      const newIdx = this.arrows.length - 1;
      this.selectedItem = { type: "arrow", index: newIdx };
      this.render();

      // 放手即在箭頭尾端就近彈出輸入框打字
      const tailScr = this.imgToScreen(finished.x2, finished.y2);
      this.openInlineEditor(tailScr.x, tailScr.y, "", "NEED_FIX", (txt, status) => {
        finished.text = txt.trim();
        finished.status = status;
        this.updateNearToolbar();
        this.emitSave(txt.trim() ? `[${this.formatStatusLabel(status)}] ${txt.trim()}` : "");
        this.render();
      });
      return;
    }

    if (finished.type === "line") {
      const dist = Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1);
      if (dist < 10) {
        this.render();
        return;
      }
      this.lines.push(finished);
      const newIdx = this.lines.length - 1;
      this.selectedItem = { type: "line", index: newIdx };
      this.render();

      const midScr = this.imgToScreen((finished.x1 + finished.x2) / 2, (finished.y1 + finished.y2) / 2);
      this.openInlineEditor(midScr.x, midScr.y, "", "SITE_CHECK", (txt, status) => {
        finished.text = txt.trim();
        finished.status = status;
        this.updateNearToolbar();
        this.emitSave(txt.trim() ? `尺寸 ${txt.trim()}` : "");
        this.render();
      });
      return;
    }

    if (finished.type === "path" && finished.points.length > 1) {
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

  openInlineEditor(screenX, screenY, initialText, initialStatus, onConfirm) {
    this.pendingInlineAction = onConfirm;
    this.inlineInput.value = initialText || "";
    const statusSel = this.inlineBox.querySelector(".mc-inline-status");
    if (statusSel) statusSel.value = initialStatus || "NEED_FIX";

    this.inlineBox.classList.remove("hidden");
    const boxW = Math.min(330, this.viewW * 0.92);
    const boxH = 230;
    const left = Math.max(10, Math.min(this.viewW - boxW - 10, screenX - boxW / 2));
    const top = screenY + 18 + boxH > this.viewH
      ? Math.max(48, screenY - boxH - 12)
      : Math.max(48, screenY + 14);

    this.inlineBox.style.left = `${left}px`;
    this.inlineBox.style.top = `${top}px`;
    this.renderInlinePhraseUI();
    setTimeout(() => {
      this.inlineInput.focus();
      this.inlineInput.setSelectionRange(this.inlineInput.value.length, this.inlineInput.value.length);
    }, 30);
  }

  renderInlinePhraseUI() {
    const phrases = this.getPhraseBank();
    const cats = ["全部", ...new Set(phrases.map(p => p.cat || "常用"))];
    const catsEl = this.inlineBox.querySelector(".mc-phrase-cats");
    const itemsEl = this.inlineBox.querySelector(".mc-phrase-items");
    if (!catsEl || !itemsEl) return;

    catsEl.innerHTML = cats.map(c => `
      <button type="button" class="mc-pcat-btn" data-pcat="${c}"
              style="padding:2px 6px; font-size:11px; border-radius:4px; border:1px solid ${this.activePhraseCat === c ? "#2563EB" : "#CBD5E1"}; background:${this.activePhraseCat === c ? "#DBEAFE" : "#FFF"}; color:${this.activePhraseCat === c ? "#1D4ED8" : "#475569"}; font-weight:700; cursor:pointer;">
        ${c}
      </button>
    `).join("");

    catsEl.querySelectorAll(".mc-pcat-btn").forEach(b => {
      b.onclick = () => {
        this.activePhraseCat = b.dataset.pcat;
        this.renderInlinePhraseUI();
      };
    });

    const filtered = this.activePhraseCat === "全部"
      ? phrases
      : phrases.filter(p => (p.cat || "常用") === this.activePhraseCat);

    itemsEl.innerHTML = filtered.map(p => `
      <button type="button" class="mc-pitem-btn" data-ptext="${p.text.replace(/"/g, "&quot;")}"
              style="text-align:left; background:#FFF; border:1px solid #E2E8F0; border-radius:4px; padding:3px 6px; font-size:11px; color:#1E293B; cursor:pointer;">
        ${p.text}
      </button>
    `).join("") || `<div style="font-size:11px; color:#94A3B8; padding:4px;">此分類尚無短語</div>`;

    itemsEl.querySelectorAll(".mc-pitem-btn").forEach(b => {
      b.onclick = () => {
        const txt = b.dataset.ptext;
        this.inlineInput.value = this.inlineInput.value
          ? `${this.inlineInput.value} ${txt}`
          : txt;
        this.inlineInput.focus();
      };
    });
  }

  commitInline(shouldSave = true) {
    if (!this.pendingInlineAction) return;
    const val = this.inlineInput.value;
    const st = this.inlineBox.querySelector(".mc-inline-status")?.value || "NEED_FIX";
    const fn = this.pendingInlineAction;
    this.pendingInlineAction = null;
    this.inlineBox.classList.add("hidden");
    if (shouldSave) fn(val, st);
  }

  getSelectedObject() {
    if (!this.selectedItem) return null;
    const { type, index } = this.selectedItem;
    if (type === "line") return this.lines[index];
    if (type === "marker") return this.markers[index];
    if (type === "path") return this.paths[index];
    if (type === "arrow") return this.arrows[index];
    if (type === "sticker") return this.stickers[index];
    return null;
  }

  getObjectAnchorImg(type, obj) {
    if (type === "marker" || type === "sticker") return { x: obj.x, y: obj.y };
    if (type === "arrow") return { x: obj.x2, y: obj.y2 };
    if (type === "line") return { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
    if (type === "path" && obj.points?.length) {
      const mid = obj.points[Math.floor(obj.points.length / 2)];
      return { x: mid.x, y: mid.y };
    }
    return { x: 0, y: 0 };
  }

  // 就近跟隨的選字／選線浮動工具條（緊貼選中物件下方約 14px，不再跑到螢幕最底）
  updateNearToolbar() {
    const obj = this.getSelectedObject();
    if (!obj) {
      this.nearToolbar.classList.add("hidden");
      return;
    }
    const anchor = this.getObjectAnchorImg(this.selectedItem.type, obj);
    const scr = this.imgToScreen(anchor.x, anchor.y);

    const slider = this.nearToolbar.querySelector(".mc-near-slider");
    const lbl = this.nearToolbar.querySelector(".mc-near-label");
    const editBtn = this.nearToolbar.querySelector(".mc-near-edit");

    if (this.selectedItem.type === "marker" || this.selectedItem.type === "sticker" || this.selectedItem.type === "arrow") {
      lbl.textContent = "字大";
      slider.min = "10";
      slider.max = "52";
      slider.step = "1";
      slider.value = String(obj.fontSize || 18);
      editBtn.classList.remove("hidden");
    } else {
      lbl.textContent = "粗幼";
      slider.min = "0.5";
      slider.max = "8";
      slider.step = "0.5";
      slider.value = String(obj.strokeWidth || 1.5);
      if (this.selectedItem.type === "line") editBtn.classList.remove("hidden");
      else editBtn.classList.add("hidden");
    }

    this.nearToolbar.classList.remove("hidden");
    const barW = 240;
    const left = Math.max(8, Math.min(this.viewW - barW - 8, scr.x - barW / 2));
    const top = scr.y + 46 > this.viewH - 12
      ? Math.max(46, scr.y - 46)
      : Math.max(46, scr.y + 14);
    this.nearToolbar.style.left = `${left}px`;
    this.nearToolbar.style.top = `${top}px`;
  }

  deleteObjectAt(type, idx) {
    if (type === "line") this.lines.splice(idx, 1);
    else if (type === "marker") this.markers.splice(idx, 1);
    else if (type === "path") this.paths.splice(idx, 1);
    else if (type === "arrow") this.arrows.splice(idx, 1);
    else if (type === "sticker") this.stickers.splice(idx, 1);
  }

  hitTest(ix, iy) {
    const tol = 18 / this.scale;
    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i];
      if (Math.abs(ix - s.x) < 60 / this.scale && Math.abs(iy - s.y) < 24 / this.scale) {
        return { type: "sticker", index: i };
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      if (Math.abs(ix - m.x) < 70 / this.scale && Math.abs(iy - m.y) < 26 / this.scale) {
        return { type: "marker", index: i };
      }
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      if (this.distToSegment(ix, iy, a.x1, a.y1, a.x2, a.y2) < tol || Math.hypot(ix - a.x2, iy - a.y2) < 55 / this.scale) {
        return { type: "arrow", index: i };
      }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (this.distToSegment(ix, iy, l.x1, l.y1, l.x2, l.y2) < tol) {
        return { type: "line", index: i };
      }
    }
    for (let i = this.paths.length - 1; i >= 0; i--) {
      const p = this.paths[i];
      for (let j = 1; j < p.points.length; j++) {
        if (this.distToSegment(ix, iy, p.points[j - 1].x, p.points[j - 1].y, p.points[j].x, p.points[j].y) < tol) {
          return { type: "path", index: i };
        }
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

  emitSave(newReviewNote = "") {
    if (typeof this.onChange === "function") {
      this.onChange({
        lines: this.lines,
        markers: this.markers,
        paths: this.paths,
        arrows: this.arrows,
        stickers: this.stickers,
        newReviewNote
      });
    }
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    // 清爽淺底無黑邊背景
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

    // 1. 自由手繪路徑（每條各自保留獨立 strokeWidth）
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
        ctx.lineWidth = ((p.strokeWidth || 1.5) + 3) / this.scale;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
      }
      ctx.restore();
    });

    // 2. 拉尺尺寸線
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
        this.drawPillLabel(ctx, mx, my, l.text, "#FFFFFF", l.color || "#2563EB", 14);
      }
      if (this.selectedItem?.type === "line" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = sw + 3 / this.scale;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
      }
      ctx.restore();
    });

    // 3. ↗ 指示箭頭線＋尾端批改文字
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

      // 箭頭尖端（指向起點 x1, y1，代表指出需要批改的位置）
      const ang = Math.atan2(a.y1 - a.y2, a.x1 - a.x2);
      const headLen = 12 / this.scale;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x1 - headLen * Math.cos(ang - Math.PI / 6), a.y1 - headLen * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(a.x1 - headLen * Math.cos(ang + Math.PI / 6), a.y1 - headLen * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();

      if (a.text) {
        this.drawPillLabel(ctx, a.x2, a.y2, a.text, col, "#FFFFFF", a.fontSize || 16);
      }
      if (this.selectedItem?.type === "arrow" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = sw + 3 / this.scale;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
      }
      ctx.restore();
    });

    // 4. 獨立文字標註
    this.markers.forEach((m, idx) => {
      ctx.save();
      const fs = (m.fontSize || 18) / this.scale;
      ctx.font = `800 ${fs}px sans-serif`;
      ctx.textBaseline = "middle";
      const metrics = ctx.measureText(m.text || "");
      const padX = 6 / this.scale;
      const padY = 4 / this.scale;
      const w = metrics.width + padX * 2;
      const h = fs + padY * 2;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(m.x - padX, m.y - h / 2, w, h);
      ctx.fillStyle = m.color || "#DC2626";
      ctx.fillText(m.text || "", m.x, m.y);

      if (this.selectedItem?.type === "marker" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = 2.5 / this.scale;
        ctx.strokeRect(m.x - padX, m.y - h / 2, w, h);
      }
      ctx.restore();
    });

    // 5. 狀態印章貼圖
    this.stickers.forEach((st, idx) => {
      ctx.save();
      this.drawPillLabel(ctx, st.x, st.y, st.label || "", st.bg || "#DC2626", st.color || "#FFFFFF", st.fontSize || 16);
      if (this.selectedItem?.type === "sticker" && this.selectedItem.index === idx) {
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = 2.5 / this.scale;
        ctx.strokeRect(st.x - 45 / this.scale, st.y - 16 / this.scale, 90 / this.scale, 32 / this.scale);
      }
      ctx.restore();
    });

    ctx.restore();
  }

  drawPillLabel(ctx, ix, iy, text, bg, fg, fontPx = 15) {
    const fs = fontPx / this.scale;
    ctx.font = `800 ${fs}px sans-serif`;
    ctx.textBaseline = "middle";
    const lines = String(text).split("\n");
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const padX = 8 / this.scale;
    const padY = 5 / this.scale;
    const lineH = fs * 1.25;
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lineH + padY * 2;
    const bx = ix - boxW / 2;
    const by = iy - boxH / 2;

    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 6 / this.scale);
    ctx.fill();

    ctx.fillStyle = fg;
    lines.forEach((ln, i) => {
      ctx.fillText(ln, bx + padX, by + padY + lineH * (i + 0.5));
    });
  }
}
