function renderFormattedReportSheetView(container, data, onCloseAction) {
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const dt = data.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-HK") : "";

  const groups = new Map();
  pages.forEach(p => {
    const sp = p.space || "未標空間";
    if (!groups.has(sp)) groups.set(sp, []);
    groups.get(sp).push(p);
  });

  const flatOrderedPages = Array.from(groups.entries()).flatMap(([sp, items]) =>
    items.map(pg => ({ ...pg, spaceTitle: sp }))
  );

  const pairedSheets = [];
  for (let i = 0; i < flatOrderedPages.length; i += 2) {
    pairedSheets.push(flatOrderedPages.slice(i, i + 2));
  }

  let layoutMode = "PORTRAIT_2IN1"; // "PORTRAIT_2IN1" | "LANDSCAPE_1IN1"

  const renderView = () => {
    const isLandscape = layoutMode === "LANDSCAPE_1IN1";
    const sheets = isLandscape ? flatOrderedPages.map(pg => [pg]) : pairedSheets;

    container.innerHTML = `
      <style>
        @page {
          size: ${isLandscape ? "A4 landscape" : "A4 portrait"};
          margin: 2mm;
        }
        @media print {
          html, body {
            background: #FFFFFF !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          header, nav, .navbar, .topbar, .no-print, #offline-status-pill {
            display: none !important;
          }
          .rpt-root-wrap {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .rpt-a4-sheet {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: #FFFFFF !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .rpt-a4-sheet:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .rpt-half-slot {
            display: block !important;
            width: 100% !important;
            height: ${isLandscape ? "202mm" : "143mm"} !important;
            margin: 0 0 ${isLandscape ? "0" : "1.5mm"} 0 !important;
            padding: 2px 3px !important;
            border: 0.4pt solid #CBD5E1 !important;
            border-radius: 2px !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            background: #FFFFFF !important;
          }
          .rpt-half-slot:last-child {
            margin-bottom: 0 !important;
          }
          .rpt-slot-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            height: 4.5mm !important;
            border-bottom: 0.4pt solid #E2E8F0 !important;
            margin-bottom: 1mm !important;
            padding: 0 2px !important;
          }
          .rpt-half-img {
            display: block !important;
            width: 100% !important;
            height: ${isLandscape ? "188mm" : "128mm"} !important;
            max-height: ${isLandscape ? "188mm" : "128mm"} !important;
            object-fit: contain !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
          }
          .rpt-meta-bar {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 2px !important;
            align-items: center !important;
            margin-top: 0.8mm !important;
            max-height: 7mm !important;
            overflow: hidden !important;
          }
        }
      </style>

      <div class="rpt-root-wrap" style="width:100%; max-width:100%; margin:0; padding:4px 6px; box-sizing:border-box; display:flex; flex-direction:column; gap:6px;">
        <div class="no-print" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; background:#FFFFFF; border:1px solid #CBD5E1; border-top:3px solid #0F172A; border-radius:6px; padding:6px 10px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <button type="button" id="rpt-view-close-btn" class="btn-outline btn-sm" style="font-weight:800;">✕ 關閉</button>
            <div>
              <strong style="font-size:15px; color:#0F172A;">${data.projectName || "現場度尺與審圖報告"}</strong>
              <span style="font-size:11px; color:#64748B; margin-left:6px;">共 ${pages.length} 張 · 排為 ${sheets.length} 頁 PDF · ${dt}</span>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <div style="display:inline-flex; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:6px; padding:2px;">
              <button type="button" id="rpt-mode-portrait"
                      style="border:none; border-radius:4px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer; background:${!isLandscape ? "#0F172A" : "transparent"}; color:${!isLandscape ? "#FFF" : "#475569"};">
                直向 2合1
              </button>
              <button type="button" id="rpt-mode-landscape"
                      style="border:none; border-radius:4px; padding:4px 10px; font-size:12px; font-weight:800; cursor:pointer; background:${isLandscape ? "#0F172A" : "transparent"}; color:${isLandscape ? "#FFF" : "#475569"};">
                橫向 1/1
              </button>
            </div>

            <button type="button" id="rpt-export-pdf-btn" class="btn-solid btn-sm" style="background:#0F172A; border-color:#0F172A;">
              📥 輸出 PDF
            </button>
          </div>
        </div>

        ${sheets.map((pair, sheetIdx) => `
          <div class="rpt-a4-sheet" style="width:100%; display:flex; flex-direction:column; gap:4px; padding:2px; background:#FFFFFF;">
            ${pair.map(pg => `
              <div class="rpt-half-slot" style="width:100%; border:0.5pt solid #CBD5E1; border-radius:3px; padding:2px 4px; box-sizing:border-box; background:#FFFFFF; display:flex; flex-direction:column; gap:2px;">
                <div class="rpt-slot-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:0.4pt solid #E2E8F0; padding:1px 2px;">
                  <strong style="font-size:11px; color:#0F172A;">${pg.spaceTitle} · ${pg.pageNum || ""}（${pg.category || ""}）</strong>
                  <span style="font-size:10px; color:#64748B;">${sheetIdx + 1}/${sheets.length}</span>
                </div>
                ${pg.imageUrl ? `<img class="rpt-half-img" src="${pg.imageUrl}" style="width:100%; max-height:${isLandscape ? "76vh" : "46vh"}; object-fit:contain; background:#FFF; display:block;" />` : ""}
                ${(pg.dimensions && pg.dimensions.length) ? `
                  <div class="rpt-meta-bar" style="display:flex; flex-wrap:wrap; gap:3px; align-items:center; padding:1px 2px;">
                    <span style="font-size:10px; font-weight:800; color:#1D4ED8;">尺寸：</span>
                    ${pg.dimensions.map(d => `<span style="background:#EFF6FF; color:#1E40AF; border:0.4pt solid #BFDBFE; border-radius:2px; padding:0 4px; font-size:10px; font-weight:700;">${d}</span>`).join("")}
                  </div>
                ` : ""}
                ${(pg.reviewLogs && pg.reviewLogs.length) ? `
                  <div class="rpt-meta-bar" style="display:flex; flex-wrap:wrap; gap:3px; align-items:center; padding:1px 2px;">
                    <span style="font-size:10px; font-weight:800; color:#991B1B;">確認：</span>
                    ${pg.reviewLogs.map(r => `<span style="background:#FEF2F2; border:0.4pt solid #FECACA; color:#991B1B; border-radius:2px; padding:0 4px; font-size:10px; font-weight:700;">${r.note}</span>`).join("")}
                  </div>
                ` : ""}
              </div>
            `).join("")}
          </div>
        `).join("")}
      </div>
    `;

    container.querySelector("#rpt-mode-portrait").onclick = () => {
      layoutMode = "PORTRAIT_2IN1";
      renderView();
    };
    container.querySelector("#rpt-mode-landscape").onclick = () => {
      layoutMode = "LANDSCAPE_1IN1";
      renderView();
    };

    container.querySelector("#rpt-view-close-btn").onclick = () => {
      if (typeof onCloseAction === "function") {
        onCloseAction();
      } else {
        window.close();
        setTimeout(() => {
          if (window.history.length > 1) window.history.back();
          else window.location.href = window.location.origin + window.location.pathname;
        }, 120);
      }
    };

    container.querySelector("#rpt-export-pdf-btn").onclick = () => {
      const prevTitle = document.title;
      const suffix = isLandscape ? "橫向1-1" : "直向2合1";
      document.title = `${data.projectName || "度尺報告"}_${suffix}`;
      window.print();
      setTimeout(() => { document.title = prevTitle; }, 500);
    };
  };

  renderView();
}
