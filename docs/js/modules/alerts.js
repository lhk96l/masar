/** وحدة التنبيهات الذكية (لوجستية) */
import { API } from "../api.js";
import { esc, fmtDate, timeAgo, statusBadge, spinner, emptyState } from "../ui.js";

export async function renderAlerts(root, app) {
  root.innerHTML = `<div class="page-head"><h1>🔔 التنبيهات</h1></div>${spinner()}`;
  let d;
  try { d = await API.alerts(); }
  catch (e) { root.innerHTML = `<div class="page-head"><h1>🔔 التنبيهات</h1></div>` + emptyState(e.message, "⚠️"); return; }

  const section = (title, icon, rows, render, color) => `
    <div class="card">
      <div class="card-head"><h2>${icon} ${title} <span class="badge badge-${color}">${rows.length}</span></h2></div>
      <div class="card-body">${rows.length ? render(rows) : emptyState("لا تنبيهات", "✅")}</div>
    </div>`;

  const demRows = (rows) => `<table class="table"><thead><tr><th>المرجع</th><th>العميل</th><th>أيام بالميناء</th><th>المتبقّي من السماح</th><th>الحالة</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="location.hash='#/shipments/${r.id}'">
      <td><strong>${esc(r.ref_no)}</strong></td><td>${esc(r.client_name || "—")}</td>
      <td>${r.days_at_port}</td>
      <td>${r.remaining_free < 0 ? `<span class="badge badge-red">تجاوز ${r.over} يوم</span>` : `<span class="badge badge-amber">${r.remaining_free} يوم</span>`}</td>
      <td>${statusBadge(r.status)}</td></tr>`).join("")}
  </tbody></table>`;

  const overdueRows = (rows) => `<table class="table"><thead><tr><th>المرجع</th><th>العميل</th><th>ETA</th><th>الحالة</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="location.hash='#/shipments/${r.id}'">
      <td><strong>${esc(r.ref_no)}</strong></td><td>${esc(r.client_name || "—")}</td>
      <td><span class="badge badge-red">${fmtDate(r.eta)}</span></td><td>${statusBadge(r.status)}</td></tr>`).join("")}
  </tbody></table>`;

  const staleRows = (rows) => `<table class="table"><thead><tr><th>المرجع</th><th>العميل</th><th>آخر تحديث</th><th>الحالة</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="location.hash='#/shipments/${r.id}'">
      <td><strong>${esc(r.ref_no)}</strong></td><td>${esc(r.client_name || "—")}</td>
      <td>${timeAgo(r.updated_at)}</td><td>${statusBadge(r.status)}</td></tr>`).join("")}
  </tbody></table>`;

  const cdlbRows = (rows) => `<table class="table"><thead><tr><th>ABR Ref</th><th>العميل</th><th>المستند/الكفالة</th><th>تاريخ الانتهاء</th></tr></thead><tbody>
    ${rows.map((r) => r.items.map((it) => `<tr class="clickable" onclick="location.hash='#/customs-ops'">
      <td><strong>${esc(r.abr_ref || "—")}</strong></td><td>${esc(r.client_name || "—")}</td>
      <td>${it.kind} ${esc(it.no || "")}</td>
      <td>${it.days_left < 0 ? `<span class="badge badge-red">منتهٍ منذ ${Math.abs(it.days_left)} يوم</span>` : `<span class="badge badge-amber">خلال ${it.days_left} يوم</span>`}</td>
    </tr>`).join("")).join("")}
  </tbody></table>`;

  root.innerHTML = `
    <div class="page-head"><h1>🔔 التنبيهات</h1></div>
    ${section("انتهاء مستندات/كفالات الكمارك (CD/LB)", "📜", d.cdlb || [], cdlbRows, "red")}
    ${section("خطر الأرضيات (Demurrage)", "⏱️", d.demurrage, demRows, "red")}
    ${section("شحنات متأخرة (تجاوزت ETA)", "⚠️", d.overdue, overdueRows, "amber")}
    ${section("شحنات راكدة (بلا تحديث +7 أيام)", "💤", d.stale, staleRows, "slate")}`;
}
