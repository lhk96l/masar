/** وحدة «لوحتي» — اللوحة الشخصية لكل موظف */
import { API, Session } from "../api.js";
import { esc, fmtDate, statusBadge, priorityBadge, STATUS_LABELS, ROLE_LABELS, spinner, emptyState } from "../ui.js";

export async function renderMyWork(root, app) {
  const u = Session.user || {};
  root.innerHTML = `<div class="page-head"><h1>👋 أهلاً ${esc(u.full_name || "")}</h1>
    <div class="head-meta"><span class="muted">${esc(ROLE_LABELS[u.role] || u.role)} · ${esc(u.department || "")}</span></div></div>${spinner()}`;
  let d;
  try { d = await API.myWork(); }
  catch (e) { root.innerHTML = `<div class="page-head"><h1>لوحتي</h1></div>` + emptyState(e.message, "⚠️"); return; }
  const t = d.totals || {};

  const cards = [
    { label: "شحناتي النشطة", value: t.active || 0, icon: "📦", color: "blue", hash: "#/shipments" },
    { label: "متأخرة (تجاوزت ETA)", value: t.overdue || 0, icon: "⚠️", color: t.overdue ? "amber" : "green" },
    { label: "تحتاج إكمال", value: t.attention || 0, icon: "🧪", color: t.attention ? "amber" : "green" },
    { label: "إشعارات غير مقروءة", value: d.unread || 0, icon: "🔔", color: d.unread ? "violet" : "green" },
  ];

  const rowTable = (rows, extra) => `<table class="table compact"><thead><tr><th>المرجع</th><th>العنوان</th><th>العميل</th>${extra ? `<th>${extra.h}</th>` : "<th>الحالة</th>"}<th>ETA</th></tr></thead><tbody>
    ${rows.map((s) => `<tr class="clickable" onclick="location.hash='#/shipments/${s.id}'">
      <td><strong>${esc(s.ref_no)}</strong></td><td>${esc(s.title || "—")}</td><td>${esc(s.client_name || "—")}</td>
      ${extra ? `<td>${extra.f(s)}</td>` : `<td>${statusBadge(s.status)}</td>`}<td>${fmtDate(s.eta)}</td></tr>`).join("")}
  </tbody></table>`;

  root.innerHTML = `
    <div class="page-head"><h1>👋 أهلاً ${esc(u.full_name || "")}</h1>
      <div class="head-meta"><span class="muted">${esc(ROLE_LABELS[u.role] || u.role)} · ${esc(u.department || "")}</span></div></div>

    <div class="stats-grid">
      ${cards.map((c) => `<div class="stat-card stat-${c.color}" ${c.hash ? `style="cursor:pointer" onclick="location.hash='${c.hash}'"` : ""}>
        <div class="stat-icon">${c.icon}</div>
        <div class="stat-body"><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div></div>`).join("")}
    </div>

    ${(d.overdue || []).length ? `<div class="card">
      <div class="card-head"><h2>⚠️ مهامي العاجلة (متأخرة)</h2></div>
      <div class="card-body">${rowTable(d.overdue, { h: "ETA متأخر", f: (s) => `<span class="badge badge-red">${fmtDate(s.eta)}</span>` })}</div></div>` : ""}

    ${(d.attention || []).length ? `<div class="card">
      <div class="card-head"><h2>🧪 شحناتي التي تحتاج إكمال بيانات</h2><a href="#/quality" class="link">جودة البيانات</a></div>
      <div class="card-body">${rowTable(d.attention, { h: "الناقص", f: (s) => `<span class="badge badge-amber">${esc(s.missing || "—")}</span>` })}</div></div>` : ""}

    <div class="card">
      <div class="card-head"><h2>📦 شحناتي النشطة (${(d.active || []).length})</h2></div>
      <div class="card-body">${(d.active || []).length ? rowTable(d.active) : emptyState("لا شحنات مُسندة إليك حاليًا", "✅")}</div>
    </div>`;
}
