/** وحدة التقارير والتحليلات */
import { API } from "../api.js";
import { esc, money, spinner, emptyState, STATUS_LABELS } from "../ui.js";

function bars(rows, labelKey, valueKey, fmt) {
  if (!rows || !rows.length) return emptyState("لا بيانات", "📊");
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  return `<div class="bars">${rows.map((r) => {
    const v = Number(r[valueKey]) || 0;
    const pct = Math.round((v / max) * 100);
    return `<div class="bar-row">
      <div class="bar-label" title="${esc(r[labelKey])}">${esc(r[labelKey] || "—")}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-value" style="width:auto;min-width:70px">${fmt ? fmt(v) : v}</div>
    </div>`;
  }).join("")}</div>`;
}

export async function renderReports(root, app) {
  if (!app.can("viewReports")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `<div class="page-head"><h1>📊 التقارير والتحليلات</h1></div>${spinner()}`;
  let d;
  try { d = await API.reports(); }
  catch (e) { root.innerHTML = `<div class="page-head"><h1>📊 التقارير</h1></div>` + emptyState(e.message, "⚠️"); return; }
  const t = d.totals || {};
  const cards = [
    { label: "إجمالي الشحنات", value: t.shipments || 0, icon: "📦", color: "blue" },
    { label: "النشطة", value: t.active || 0, icon: "🚢", color: "violet" },
    { label: "عمليات الكمارك", value: t.customs_ops || 0, icon: "📜", color: "amber" },
    { label: "إجمالي الغرامات", value: money(t.penalties_total, "IQD"), icon: "⚖️", color: "green" },
  ];
  const statusRows = (d.by_status || []).map((r) => ({ label: STATUS_LABELS[r.status] || r.status, c: r.c }));

  // تعبئة الأشهر الفارغة بين أقدم وأحدث شهر (لإظهار مثل أكتوبر بصفر)
  let monthsFilled = (d.by_month || []).slice();
  if (monthsFilled.length) {
    const present = {}; monthsFilled.forEach((r) => (present[r.month] = r.c));
    const sorted = monthsFilled.map((r) => r.month).sort();
    const [sy, sm] = sorted[0].split("-").map(Number);
    const [ey, em] = sorted[sorted.length - 1].split("-").map(Number);
    const full = [];
    for (let y = sy, m = sm; y < ey || (y === ey && m <= em);) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      full.push({ month: key, c: present[key] || 0 });
      m++; if (m > 12) { m = 1; y++; }
    }
    monthsFilled = full;
  }
  const withEta = (d.totals && d.totals.with_eta) || 0;
  root.innerHTML = `
    <div class="page-head"><h1>📊 التقارير والتحليلات</h1></div>
    <div class="stats-grid">
      ${cards.map((c) => `<div class="stat-card stat-${c.color}"><div class="stat-icon">${c.icon}</div>
        <div class="stat-body"><div class="stat-value" style="font-size:20px">${c.value}</div><div class="stat-label">${c.label}</div></div></div>`).join("")}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>الشحنات حسب الحالة</h2></div><div class="card-body">${bars(statusRows, "label", "c")}</div></div>
      <div class="card"><div class="card-head"><h2>الشحنات حسب العميل</h2></div><div class="card-body">${bars(d.by_client, "client", "c")}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>⚖️ الغرامات حسب الخط الملاحي</h2></div><div class="card-body">${bars(d.pen_by_line, "line", "total", (v) => money(v, "IQD"))}</div></div>
      <div class="card"><div class="card-head"><h2>⚖️ الغرامات حسب العميل</h2></div><div class="card-body">${bars(d.pen_by_client, "client", "total", (v) => money(v, "IQD"))}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>حجم الشحنات شهريًا (حسب ETA)</h2></div><div class="card-body">
      <div class="alert alert-info" style="margin-bottom:14px">يشمل <strong>${withEta}</strong> شحنة لها تاريخ ETA من أصل <strong>${t.shipments || 0}</strong> (الباقي بلا ETA في الـ DSR). الأشهر الفارغة تظهر بصفر.</div>
      ${bars(monthsFilled, "month", "c")}</div></div>`;
}
