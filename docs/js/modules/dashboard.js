/** وحدة لوحة المعلومات */
import { API } from "../api.js";
import { esc, fmtDate, statusBadge, priorityBadge, STATUS_LABELS, spinner, emptyState } from "../ui.js";

export async function renderDashboard(root, app) {
  root.innerHTML = `<div class="page-head"><h1>لوحة المعلومات</h1></div>${spinner()}`;
  let data;
  try {
    data = await API.dashboard();
  } catch (e) {
    root.innerHTML = `<div class="page-head"><h1>لوحة المعلومات</h1></div>` + emptyState("تعذّر تحميل البيانات: " + e.message, "⚠️");
    return;
  }
  const t = data.totals || {};
  const statusMap = {};
  (data.by_status || []).forEach((r) => (statusMap[r.status] = r.c));

  const cards = [
    { label: "إجمالي الشحنات", value: t.total_shipments || 0, icon: "📦", color: "blue" },
    { label: "الشحنات النشطة", value: t.active_shipments || 0, icon: "🚢", color: "violet" },
    { label: "الموردون", value: t.total_suppliers || 0, icon: "🏭", color: "amber" },
    { label: "المستخدمون", value: t.total_users || 0, icon: "👥", color: "green" },
  ];

  root.innerHTML = `
    <div class="page-head">
      <h1>لوحة المعلومات</h1>
      <div class="page-actions">
        ${app.can("writeShipments") ? `<a href="#/shipments/new" class="btn btn-primary">+ شحنة جديدة</a>` : ""}
      </div>
    </div>

    <div class="stats-grid">
      ${cards.map((c) => `
        <div class="stat-card stat-${c.color}">
          <div class="stat-icon">${c.icon}</div>
          <div class="stat-body"><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>
        </div>`).join("")}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>الشحنات حسب المرحلة</h2></div>
        <div class="card-body">
          ${renderStatusBars(statusMap, t.total_shipments || 0)}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>مهامي</h2></div>
        <div class="card-body">
          ${(data.my_tasks || []).length ? `
            <table class="table compact">
              <thead><tr><th>المرجع</th><th>العنوان</th><th>الحالة</th><th>ETA</th></tr></thead>
              <tbody>
                ${data.my_tasks.map((s) => `
                  <tr class="clickable" onclick="location.hash='#/shipments/${s.id}'">
                    <td><strong>${esc(s.ref_no)}</strong></td>
                    <td>${esc(s.title)}</td>
                    <td>${statusBadge(s.status)}</td>
                    <td>${fmtDate(s.eta)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>` : emptyState("لا مهام مُسندة إليك حالياً", "✅")}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>أحدث الشحنات</h2><a href="#/shipments" class="link">عرض الكل</a></div>
      <div class="card-body">
        ${(data.recent || []).length ? `
          <table class="table">
            <thead><tr><th>المرجع</th><th>العنوان</th><th>المورد</th><th>الأولوية</th><th>الحالة</th><th>التاريخ</th></tr></thead>
            <tbody>
              ${data.recent.map((s) => `
                <tr class="clickable" onclick="location.hash='#/shipments/${s.id}'">
                  <td><strong>${esc(s.ref_no)}</strong></td>
                  <td>${esc(s.title)}</td>
                  <td>${esc(s.supplier_name || "—")}</td>
                  <td>${priorityBadge(s.priority)}</td>
                  <td>${statusBadge(s.status)}</td>
                  <td>${fmtDate(s.created_at)}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : emptyState("لا توجد شحنات بعد — ابدأ بإنشاء أول شحنة", "📦")}
      </div>
    </div>
  `;
}

function renderStatusBars(map, total) {
  const flow = ["opened", "at_port", "customs_clearance", "in_transport", "delivered", "closed"];
  const rows = flow.map((st) => {
    const c = map[st] || 0;
    const pct = total ? Math.round((c / total) * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-label">${STATUS_LABELS[st]}</div>
        <div class="bar-track"><div class="bar-fill bar-${st}" style="width:${pct}%"></div></div>
        <div class="bar-value">${c}</div>
      </div>`;
  }).join("");
  return `<div class="bars">${rows}</div>`;
}
