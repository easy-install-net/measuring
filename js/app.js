// ==========================================
// 4. 全屏無黑邊批改編輯器（最頂頂整合：顏色圓點 · 幼細滑桿 · ⊡ 置中 · ↗ 箭頭批改）
// ==========================================
async function renderSinglePageEditor(page) {
  const totalPages = currentProject.pages.length;
  const catLabel = normalizePageCategory(page);
  const allSpaces = [...new Set((currentProject.pages || []).map(p => p.space || "未標空間"))];
  if (!Array.isArray(page.reviewLogs)) page.reviewLogs = [];

  const rawColors = Array.isArray(masterDict?.rulerColors) ? masterDict.rulerColors : [];
  const paletteColors = rawColors.map(c => (typeof c === "string" ? c : (c?.hex || c?.color || c?.value || ""))).filter(Boolean);
  const finalColors = paletteColors.length ? paletteColors : ["#DC2626", "#2563EB", "#059669", "#9333EA", "#EA580C", "#111827"];

  root.innerHTML = `
    <div id="fullscreen-editor-shell" style="position:fixed; inset:0; width:100vw; height:100vh; background:#F8FAFC; display:flex; flex-direction:column; z-index:900; overflow:hidden;">
      <!-- 最頂頂列：空間分類 ｜ 通用屬性（顏色圓點 · 幼細滑桿 · ⊡ 置中）｜ C 組專職批改（↗ 箭頭批改）｜ 白底/記錄/儲存 -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; background:#FFFFFF; border-bottom:1px solid #E2E8F0; flex-wrap:wrap; gap:5px; z-index:20;">
        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
          <button id="btn-back-grid" style="background:#0F172A; color:#FFF; border:none; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">‹ 返回圖集</button>
          <strong style="font-size:13px; color:#0F172A;">${page.pageNum || `P${activePageIdx + 1}`}</strong>

          <select id="ed-space-sel" title="更改所屬空間" style="padding:3px 5px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700; color:#0F172A; background:#F8FAFC;">
            ${allSpaces.map(sp => `<option value="${sp}" ${sp === (page.space || "未標空間") ? "selected" : ""}>${sp}</option>`).join("")}
            <option value="__NEW__">+ 新空間...</option>
          </select>
          <select id="ed-cat-sel" title="更改圖紙分類" style="padding:3px 5px; border:1px solid #CBD5E1; border-radius:5px; font-size:12px; font-weight:700; color:#1D4ED8; background:#EFF6FF;">
            ${CORE_CATEGORIES.map(c => `<option value="${c}" ${c === catLabel ? "selected" : ""}>${c}</option>`).join("")}
          </select>
          <span style="font-size:11px; color:#64748B;">(${activePageIdx + 1}/${totalPages})</span>
        </div>

        <!-- 最頂頂中間：顏色圓點 · 幼細滑桿 · ⊡ 置中 -->
        <div style="display:flex; align-items:center; gap:5px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:999px; padding:2px 8px;">
          <div id="top-color-dots" style="display:flex; align-items:center; gap:4px;">
            ${finalColors.map((c, idx) => `
              <button type="button" class="top-cdot" data-tcol="${c}"
                      style="width:16px; height:16px; border-radius:50%; background-color:${c}; border:${idx === 0 ? "2.5px solid #0F172A" : "1px solid #64748B"}; cursor:pointer; padding:0; flex-shrink:0;"></button>
            `).join("")}
          </div>

          <span style="color:#CBD5E1;">|</span>

          <label style="display:flex; align-items:center; gap:3px; font-size:11px; color:#334155; white-space:nowrap;">
            <span>幼細</span>
            <input type="range" id="top-stroke-slider" min="0.5" max="8" step="0.5" value="1.5" style="width:48px; accent-color:#2563EB;" />
            <span id="top-stroke-val" style="min-width:20px; font-weight:700;">1.5</span>
          </label>

          <button type="button" id="btn-top-reset-zoom" title="重置縮放置中" style="background:#FFF; border:1px solid #CBD5E1; border-radius:999px; padding:1px 7px; font-size:11px; font-weight:700; color:#334155; cursor:pointer; white-space:nowrap;">⊡ 置中</button>
        </div>

        <!-- 最頂頂右邊：C 組 ↗ 箭頭批改 ＋ 白底 ＋ 批改記錄 ＋ 儲存 ＋ 換底圖 -->
        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
          <button type="button" id="btn-top-arrow-mode" style="background:#FEF2F2; color:#DC2626; border:1.5px solid #FCA5A5; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">↗ 箭頭批改</button>
          <button id="btn-toggle-white-bg" style="background:#F8FAFC; color:#0F172A; border:1px solid #CBD5E1; border-radius:6px; padding:4px 7px; font-size:12px; font-weight:700; cursor:pointer;">📄 白底</button>
          <button id="btn-page-review-drawer" style="background:#FFF; color:#991B1B; border:1px solid #FECACA; border-radius:6px; padding:4px 8px; font-size:12px; font-weight:800; cursor:pointer;">
            📝 記錄 (${page.reviewLogs.length})
          </button>
          <button id="btn-manual-save" style="background:#059669; color:#FFF; border:none; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:800; cursor:pointer;">💾 儲存</button>
          <label style="background:#F1F5F9; color:#334155; border:1px solid #CBD5E1; border-radius:6px; padding:4px 7px; font-size:12px; font-weight:700; cursor:pointer;">
            📷 換底圖
            <input type="file" id="up-site-photo" accept="image/*" class="hidden" />
          </label>
        </div>
      </div>

      <!-- 批改記錄抽屜 -->
      <div id="page-review-drawer" class="hidden" style="position:absolute; right:12px; top:44px; width:min(360px, 94vw); max-height:78vh; overflow-y:auto; background:#FFFFFF; color:#0F172A; border:1.5px solid #CBD5E1; border-radius:10px; padding:10px; box-shadow:0 12px 28px rgba(15,23,42,0.18); z-index:40; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:5px;">
          <strong style="font-size:13px; color:#0F172A;">📝 本頁審圖批改記錄</strong>
          <button id="btn-close-page-rev" style="background:none; border:none; color:#64748B; font-size:14px; cursor:pointer;">✕</button>
        </div>

        <div style="display:flex; gap:5px; align-items:center;">
          <select id="new-rev-status" style="padding:4px 6px; border-radius:5px; border:1px solid #CBD5E1; font-size:12px; font-weight:700;">
            <option value="NEED_FIX">❌ 需修改</option>
            <option value="SITE_CHECK">⚠️ 現場核對</option>
            <option value="NEED_INFO">📌 待補資料</option>
            <option value="OK">✅ 確認無誤</option>
          </select>
          <button id="btn-drawer-cloud-dict" style="margin-left:auto; background:#EFF6FF; border:1px solid #93C5FD; border-radius:5px; padding:3px 7px; font-size:11px; font-weight:700; color:#1D4ED8; cursor:pointer;">⚙️ 管理雲端詞庫</button>
        </div>

        <textarea id="new-rev-note" rows="2" placeholder="輸入批改要求，或點下方雲端短語一鍵帶入..."
                  style="width:100%; box-sizing:border-box; padding:6px 8px; border-radius:6px; border:1.5px solid #93C5FD; font-size:13px; resize:vertical; font-family:inherit;"></textarea>

        <div id="drawer-phrase-chips" style="display:flex; flex-wrap:wrap; gap:4px; max-height:90px; overflow-y:auto;"></div>

        <button id="btn-add-rev-note" style="background:#2563EB; color:#FFF; border:none; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:800; cursor:pointer;">
          + 新增批改記錄
        </button>

        <div id="page-rev-items" style="display:flex; flex-direction:column; gap:5px; font-size:12px;"></div>
      </div>

      <div id="sub-module-host" style="flex:1; width:100%; height:100%; position:relative; overflow:hidden; background:#F8FAFC;">
        <div style="color:#64748B; text-align:center; padding:50px; font-size:14px;">正在按需載入本頁底圖...</div>
      </div>
    </div>
  `;

  // 最頂頂色點 / 幼細 / 置中 / ↗ 箭頭批改 控制綁定
  const topArrowBtn = document.getElementById("btn-top-arrow-mode");
  topArrowBtn.onclick = () => {
    if (!activeCanvasInstance) return;
    const nextMode = activeCanvasInstance.mode === "ARROW" ? "VIEW" : "ARROW";
    activeCanvasInstance.setMode(nextMode);
  };

  document.querySelectorAll(".top-cdot").forEach(dot => {
    dot.onclick = () => {
      const col = dot.dataset.tcol;
      document.querySelectorAll(".top-cdot").forEach(d => {
        d.style.border = d.dataset.tcol === col ? "2.5px solid #0F172A" : "1px solid #64748B";
      });
      if (activeCanvasInstance) activeCanvasInstance.setActiveColor(col);
    };
  });

  const topStrokeSlider = document.getElementById("top-stroke-slider");
  const topStrokeVal = document.getElementById("top-stroke-val");
  topStrokeSlider.oninput = () => {
    const v = parseFloat(topStrokeSlider.value);
    topStrokeVal.textContent = String(v);
    if (activeCanvasInstance) activeCanvasInstance.setStrokeWidth(v);
  };
  topStrokeSlider.onchange = () => {
    if (activeCanvasInstance && activeCanvasInstance.selectedItem) activeCanvasInstance.emitSave();
  };

  document.getElementById("btn-top-reset-zoom").onclick = () => {
    if (activeCanvasInstance) activeCanvasInstance.resetZoom();
  };

  document.getElementById("ed-space-sel").onchange = async (e) => {
    const val = e.target.value;
    if (val === "__NEW__") {
      const custom = prompt("輸入新空間名稱：");
      if (custom && custom.trim()) {
        page.space = custom.trim();
        page.title = `${page.space} · ${normalizePageCategory(page)}`;
        await saveCurrentProject();
        renderSinglePageEditor(page);
      } else {
        e.target.value = page.space || "未標空間";
      }
      return;
    }
    page.space = val;
    page.title = `${page.space} · ${normalizePageCategory(page)}`;
    await saveCurrentProject();
  };

  document.getElementById("ed-cat-sel").onchange = async (e) => {
    page.docTypeLabel = e.target.value;
    page.title = `${page.space || "未標空間"} · ${page.docTypeLabel}`;
    await saveCurrentProject();
  };

  const renderDrawerPhrases = () => {
    const box = document.getElementById("drawer-phrase-chips");
    if (!box) return;
    box.innerHTML = cloudPhraseBank.slice(0, 18).map(p => `
      <button type="button" class="drw-phrase-chip" data-ptext="${p.text.replace(/"/g, "&quot;")}"
              style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:4px; padding:2px 6px; font-size:11px; color:#334155; cursor:pointer;">
        ${p.text}
      </button>
    `).join("") || `<span style="font-size:11px; color:#94A3B8;">雲端尚無短語，點上方「⚙️ 管理雲端詞庫」新增或匯入範本。</span>`;
    box.querySelectorAll(".drw-phrase-chip").forEach(btn => {
      btn.onclick = () => {
        const inp = document.getElementById("new-rev-note");
        inp.value = inp.value ? `${inp.value} ${btn.dataset.ptext}` : btn.dataset.ptext;
        inp.focus();
      };
    });
  };
  renderDrawerPhrases();

  document.getElementById("btn-drawer-cloud-dict").onclick = () => openCloudDictModal("PHRASE", renderDrawerPhrases);

  const renderPageRevItems = () => {
    const listEl = document.getElementById("page-rev-items");
    const badgeBtn = document.getElementById("btn-page-review-drawer");
    if (badgeBtn) badgeBtn.textContent = `📝 記錄 (${page.reviewLogs.length})`;
    if (!listEl) return;
    if (!page.reviewLogs.length) {
      listEl.innerHTML = `<div style="color:#94A3B8; font-size:11px;">尚無批改記錄，可使用頂部「↗ 箭頭批改」拉線即打字或在上方輸入。</div>`;
      return;
    }
    listEl.innerHTML = page.reviewLogs.map((r, i) => {
      const stKey = normalizeReviewStatus(r.status);
      const meta = REVIEW_STATUS_META[stKey];
      return `
        <div style="background:${meta.bg}; border:1px solid ${meta.border}; border-radius:6px; padding:6px 8px; display:flex; justify-content:space-between; align-items:center; gap:6px;">
          <div style="flex:1;">
            <div style="font-size:10px; color:#64748B;">${r.time || ""}</div>
            <div style="color:${meta.text}; font-weight:700; white-space:pre-wrap;">${r.note}</div>
          </div>
          <button class="page-rev-cycle" data-ridx="${i}" style="background:${meta.badgeBg}; color:${meta.badgeText}; border:none; border-radius:4px; padding:3px 7px; font-size:10px; font-weight:800; cursor:pointer; white-space:nowrap;">
            ${meta.label} ↻
          </button>
          <button class="page-rev-del" data-ridx="${i}" style="background:none; border:none; color:#64748B; font-size:12px; cursor:pointer;">✕</button>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".page-rev-cycle").forEach(b => {
      b.onclick = async () => {
        const item = page.reviewLogs[Number(b.dataset.ridx)];
        if (!item) return;
        const cur = normalizeReviewStatus(item.status);
        item.status = STATUS_CYCLE_ORDER[(STATUS_CYCLE_ORDER.indexOf(cur) + 1) % STATUS_CYCLE_ORDER.length];
        renderPageRevItems();
        await saveCurrentProject();
      };
    });
    listEl.querySelectorAll(".page-rev-del").forEach(b => {
      b.onclick = async () => {
        page.reviewLogs.splice(Number(b.dataset.ridx), 1);
        renderPageRevItems();
        await saveCurrentProject();
      };
    });
  };
  renderPageRevItems();

  document.getElementById("btn-page-review-drawer").onclick = () => document.getElementById("page-review-drawer").classList.toggle("hidden");
  document.getElementById("btn-close-page-rev").onclick = () => document.getElementById("page-review-drawer").classList.add("hidden");
  document.getElementById("btn-add-rev-note").onclick = async () => {
    const inp = document.getElementById("new-rev-note");
    const st = document.getElementById("new-rev-status").value;
    const txt = inp.value.trim();
    if (!txt) return;
    const now = new Date();
    const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    page.reviewLogs.unshift({ time: tStr, note: txt, status: st });
    inp.value = "";
    renderPageRevItems();
    await saveCurrentProject();
  };

  const saveAndRun = async (fn) => {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(false);
    await saveCurrentProject();
    fn();
  };

  document.getElementById("btn-back-grid").onclick = () => {
    saveAndRun(() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      activePageIdx = -1;
      renderWorkspace();
    });
  };

  const saveBtn = document.getElementById("btn-manual-save");
  saveBtn.onclick = async () => {
    if (activeCanvasInstance) activeCanvasInstance.commitInline(true);
    saveBtn.textContent = "儲存中...";
    await saveCurrentProject();
    saveBtn.textContent = "✅ 已儲存";
    setTimeout(() => { saveBtn.textContent = "💾 儲存"; }, 1400);
  };

  const host = document.getElementById("sub-module-host");

  const showMeasure = () => {
    if (!page.sitePhotoUrl) {
      host.innerHTML = `<div style="color:#475569; text-align:center; padding:50px; font-size:15px;">請先點擊右上角「📷 換底圖」拍照，或按「📄 白底」直接開白底草圖。</div>`;
      return;
    }
    activeCanvasInstance = new MeasureCanvas(
      host,
      page.sitePhotoUrl,
      {
        lines: page.lines || [],
        markers: page.markers || [],
        paths: page.paths || [],
        arrows: page.arrows || [],
        stickers: page.stickers || []
      },
      finalColors,
      async (updated) => {
        page.lines = updated.lines || [];
        page.markers = updated.markers || [];
        if (updated.paths) page.paths = updated.paths;
        if (updated.arrows) page.arrows = updated.arrows;
        if (updated.stickers) page.stickers = updated.stickers;
        if (updated.newReviewNote) {
          const now = new Date();
          const tStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          page.reviewLogs.unshift({
            time: tStr,
            note: updated.newReviewNote,
            status: updated.newReviewStatus || "NEED_FIX"
          });
          renderPageRevItems();
        }
        await saveCurrentProject();
      },
      {
        hasPrev: activePageIdx > 0,
        hasNext: activePageIdx < totalPages - 1,
        getPhraseBank: () => cloudPhraseBank,
        getStampGroups: () => cloudStampGroups,
        onModeSync: (m) => {
          if (m === "ARROW") {
            topArrowBtn.style.background = "#DC2626";
            topArrowBtn.style.color = "#FFFFFF";
          } else {
            topArrowBtn.style.background = "#FEF2F2";
            topArrowBtn.style.color = "#DC2626";
          }
        },
        onOpenDictManager: (tab, cb) => openCloudDictModal(tab, () => {
          renderDrawerPhrases();
          if (typeof cb === "function") cb();
        }),
        onPrev: () => { if (activePageIdx > 0) saveAndRun(() => { activePageIdx--; renderWorkspace(); }); },
        onNext: () => { if (activePageIdx < totalPages - 1) saveAndRun(() => { activePageIdx++; renderWorkspace(); }); }
      }
    );
  };

  const whiteBtn = document.getElementById("btn-toggle-white-bg");
  whiteBtn.onclick = () => {
    if (!activeCanvasInstance) { page.sitePhotoUrl = createBlankWhiteDataUrl(); showMeasure(); return; }
    const isWhite = activeCanvasInstance.toggleWhiteBackground();
    whiteBtn.style.background = isWhite ? "#FEF08A" : "#F8FAFC";
    whiteBtn.textContent = isWhite ? "🖼️ 還原底圖" : "📄 白底";
  };

  document.getElementById("up-site-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div style="color:#475569; text-align:center; padding:50px;">正在壓縮並同步底圖至雲端...</div>`;
    const res = await uploadMediaToCloud(currentProject.id, page.id, file);
    page.sitePhotoUrl = res.imageData;
    memoryPhotoCache.set(page.id, res.imageData);
    await saveCurrentProject();
    showMeasure();
  };

  await ensureSinglePagePhoto(currentProject, page);
  showMeasure();
}
