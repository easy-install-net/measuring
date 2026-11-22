function renderSinglePageEditor(page) {
  const totalPages = currentProject.pages.length;
  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
      <div style="display:flex; align-items:center; gap:6px;">
        <button id="btn-back-grid" class="btn-outline btn-sm">‹ 返回圖集</button>
        <strong style="font-size:14px;">${page.pageNum || ""} ${page.space || ""} · ${page.docTypeLabel || ""}</strong>
      </div>
      <div style="display:flex; align-items:center; gap:5px;">
        <button id="btn-prev-page" class="btn-outline btn-sm" ${activePageIdx <= 0 ? "disabled" : ""}>‹ 上一頁</button>
        <span style="font-size:12px; color:#6B7280;">${activePageIdx + 1}/${totalPages}</span>
        <button id="btn-next-page" class="btn-outline btn-sm" ${activePageIdx >= totalPages - 1 ? "disabled" : ""}>下一頁 ›</button>
        <label class="btn-outline btn-sm" style="cursor:pointer; margin-left:4px;">
          📷 換底圖
          <input type="file" id="up-site-photo" accept="image/*" class="hidden" />
        </label>
      </div>
    </div>
    <div id="sub-module-host"></div>
  `;

  document.getElementById("btn-back-grid").onclick = () => {
    activePageIdx = -1;
    renderWorkspace();
  };
  document.getElementById("btn-prev-page").onclick = () => {
    if (activePageIdx > 0) { activePageIdx--; renderWorkspace(); }
  };
  document.getElementById("btn-next-page").onclick = () => {
    if (activePageIdx < totalPages - 1) { activePageIdx++; renderWorkspace(); }
  };

  const host = document.getElementById("sub-module-host");

  const showMeasure = () => {
    if (!page.sitePhotoUrl) {
      host.innerHTML = `<div class="card" style="color:#4B5563; text-align:center; padding:30px;">請先點擊上方「📷 換底圖」拍照或選取底圖開始拉尺。</div>`;
      return;
    }
    new MeasureCanvas(
      host,
      page.sitePhotoUrl,
      { lines: page.lines || [], markers: page.markers || [] },
      masterDict.rulerColors,
      async (updated) => {
        page.lines = updated.lines;
        page.markers = updated.markers;
        await saveCurrentProject();
      }
    );
  };

  document.getElementById("up-site-photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    host.innerHTML = `<div class="card">正在壓縮並同步底圖至雲端...</div>`;
    const res = await uploadMediaToCloud(currentProject.id, page.id, file);
    page.sitePhotoUrl = res.imageData;
    memoryPhotoCache.set(page.id, res.imageData);
    await saveCurrentProject();
    showMeasure();
  };

  showMeasure();
}
