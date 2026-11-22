export function renderAuditSplitView(container, pageData, onSaveTickets) {
  const siteImg = pageData.sitePhotoUrl || "";
  const designImg = pageData.designPhotoUrl || "";
  const tickets = pageData.auditTickets || [];

  container.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span class="section-title" style="margin:0;">上下分屏審圖比對</span>
        <button id="btn-add-ticket" class="btn-solid btn-sm">+ 新增審圖批核問題</button>
      </div>

      <div style="display:grid; grid-template-rows: 220px 220px; gap:8px; margin-bottom:12px;">
        <div style="position:relative; border:1px solid #111827; border-radius:4px; overflow:auto; background:#111;">
          <span style="position:sticky; top:4px; left:4px; background:rgba(0,0,0,0.75); color:#FFF; font-size:11px; padding:2px 6px; border-radius:3px;">現場實測圖</span>
          ${siteImg ? `<img src="${siteImg}" style="width:100%; display:block;" />` : `<div style="color:#9CA3AF; padding:40px; text-align:center;">尚未上傳現場圖</div>`}
        </div>
        <div style="position:relative; border:1px solid #111827; border-radius:4px; overflow:auto; background:#111;">
          <span style="position:sticky; top:4px; left:4px; background:rgba(0,0,0,0.75); color:#FFF; font-size:11px; padding:2px 6px; border-radius:3px;">設計師圖紙</span>
          ${designImg ? `<img src="${designImg}" style="width:100%; display:block;" />` : `<div style="color:#9CA3AF; padding:40px; text-align:center;">尚未上傳設計圖</div>`}
        </div>
      </div>

      <div id="ticket-form-box" class="hidden" style="background:#F9FAFB; border:1px solid #111827; padding:10px; border-radius:4px; margin-bottom:10px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px;">
          <input type="number" id="tk-site-val" placeholder="現場實測 (mm)" style="padding:7px; border:1px solid #D1D5DB; border-radius:4px;" />
          <input type="number" id="tk-design-val" placeholder="圖紙標示 (mm)" style="padding:7px; border:1px solid #D1D5DB; border-radius:4px;" />
        </div>
        <input type="text" id="tk-desc" placeholder="衝突說明 / 修改要求（例：橫樑底低於圖紙，需改矮櫃身）"
               style="width:100%; padding:7px; border:1px solid #D1D5DB; border-radius:4px; margin-bottom:8px;" />
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <select id="tk-status" style="padding:6px; border:1px solid #111827; border-radius:4px; font-weight:700;">
            <option value="conflict">🔴 衝突 / 需改圖</option>
            <option value="pending">🟡 待設計師確認</option>
            <option value="pass">🟢 尺寸吻合通過</option>
          </select>
          <div style="display:flex; gap:6px;">
            <button id="tk-cancel" class="btn-outline btn-sm">取消</button>
            <button id="tk-save" class="btn-solid btn-sm">儲存紀錄</button>
          </div>
        </div>
      </div>

      <div id="ticket-list" style="display:flex; flex-direction:column; gap:6px;"></div>
    </div>
  `;

  const renderTickets = () => {
    const listEl = container.querySelector("#ticket-list");
    if (!tickets.length) {
      listEl.innerHTML = `<div style="font-size:13px; color:#6B7280;">暫無審圖異常紀錄。</div>`;
      return;
    }
    const statusMap = {
      conflict: { label: "🔴 衝突需改", color: "#DC2626" },
      pending:  { label: "🟡 待確認",   color: "#D97706" },
      pass:     { label: "🟢 通過",     color: "#16A34A" }
    };
    listEl.innerHTML = tickets.map((t, idx) => {
      const st = statusMap[t.status] || statusMap.pending;
      const diff = (t.siteVal && t.designVal) ? `（差值：${t.siteVal - t.designVal} mm）` : "";
      return `
        <div style="border:1px solid #D1D5DB; border-left:4px solid ${st.color}; padding:8px 10px; border-radius:4px; background:#FFF;">
          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700;">
            <span style="color:${st.color};">${st.label}</span>
            <span>現場 ${t.siteVal || "-"} vs 圖紙 ${t.designVal || "-"} ${diff}</span>
          </div>
          <div style="font-size:14px; margin-top:4px;">${t.desc || "無補充說明"}</div>
          <div style="text-align:right; margin-top:4px;">
            <button data-idx="${idx}" class="tk-del-btn" style="background:none; border:none; color:#6B7280; font-size:12px; cursor:pointer; text-decoration:underline;">移除</button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".tk-del-btn").forEach(btn => {
      btn.onclick = () => {
        tickets.splice(Number(btn.dataset.idx), 1);
        renderTickets();
        if (onSaveTickets) onSaveTickets(tickets);
      };
    });
  };

  renderTickets();

  const formBox = container.querySelector("#ticket-form-box");
  container.querySelector("#btn-add-ticket").onclick = () => formBox.classList.remove("hidden");
  container.querySelector("#tk-cancel").onclick = () => formBox.classList.add("hidden");
  container.querySelector("#tk-save").onclick = () => {
    const siteVal = Number(container.querySelector("#tk-site-val").value) || 0;
    const designVal = Number(container.querySelector("#tk-design-val").value) || 0;
    const desc = container.querySelector("#tk-desc").value.trim();
    const status = container.querySelector("#tk-status").value;
    tickets.push({ id: "TK_" + Date.now(), siteVal, designVal, desc, status });
    formBox.classList.add("hidden");
    renderTickets();
    if (onSaveTickets) onSaveTickets(tickets);
  };
}
