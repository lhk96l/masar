/** وحدة جودة البيانات — تكشف الشحنات الناقصة الحقول ليُكملها الموظفون */
import { API } from "../api.js";
import { esc, statusBadge, spinner, emptyState } from "../ui.js";

const CATS = [
  { key: "no_assigned", label: "بلا مسؤول (PIC)", icon: "👤", hint: "أضف خانة PIC في الشيت" },
  { key: "no_line", label: "بلا خط ملاحي", icon: "🚢", hint: "أضف Shipping Line Agent" },
  { key: "no_eta", label: "بلا موعد وصول (ETA)", icon: "📅", hint: "أضف Vessel ETA" },
  { key: "no_client", label: "بلا عميل", icon: "🏢", hint: "حدّد العميل" },
  { key: "no_bl", label: "بلا بوليصة شحن (BL)", icon: "📄", hint: "أضف BL #" },
];

export async function renderQuality(root, app) {
  if (!app.can("writeShipments") && !app.can("manageUsers")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `<div class="page-head"><h1>🧪 جودة البيانات</h1>
    <div class="page-actions"><button class="btn btn-ghost" id="q-refresh">↻ تحديث</button></div></div>
    <div id="q-body">${spinner()}</div>`;
  document.getElementById("q-refresh").onclick = () => load();

  const load = async () => {
    const box = document.getElementById("q-body");
    box.innerHTML = spinner();
    let d;
    try { d = await API.quality(); }
    catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); return; }
    const s = d.summary || {};
    const total = s.total || 0;
    // درجة اكتمال تقريبية
    const missingTotal = (s.no_assigned || 0) + (s.no_line || 0) + (s.no_eta || 0) + (s.no_client || 0) + (s.no_bl || 0);
    const maxPossible = total * 5 || 1;
    const score = Math.round(100 - (missingTotal / maxPossible) * 100);

    box.innerHTML = `
      <div class="alert ${score >= 85 ? "alert-info" : "alert-danger"}" style="margin-bottom:16px">
        درجة اكتمال البيانات: <strong>${score}%</strong> لـ ${total} شحنة نشطة.
        ${score >= 85 ? "بيانات ممتازة ✅" : "هناك حقول ناقصة — أكملها في Google Sheets لترتفع الدقّة."}
      </div>
      <div class="stats-grid">
        ${CATS.map((c) => `<div class="stat-card stat-${(s[c.key] || 0) > 0 ? "amber" : "green"}">
          <div class="stat-icon">${c.icon}</div>
          <div class="stat-body"><div class="stat-value">${s[c.key] || 0}</div><div class="stat-label">${c.label}</div></div></div>`).join("")}
      </div>
      ${CATS.filter((c) => (d.lists[c.key] || []).length).map((c) => `
        <div class="card">
          <div class="card-head"><h2>${c.icon} ${c.label} <span class="badge badge-amber">${(d.lists[c.key] || []).length}${s[c.key] > (d.lists[c.key] || []).length ? "+" : ""}</span></h2>
            <span class="muted">${esc(c.hint)}</span></div>
          <div class="card-body">
            <table class="table compact"><thead><tr><th>المرجع</th><th>العنوان</th><th>العميل</th><th>المسؤول</th><th>الحالة</th></tr></thead><tbody>
              ${(d.lists[c.key] || []).map((r) => `<tr class="clickable" onclick="location.hash='#/shipments/${r.id}'">
                <td><strong>${esc(r.ref_no)}</strong></td><td>${esc(r.title || "—")}</td>
                <td>${esc(r.client_name || "—")}</td><td>${esc(r.assigned_name || "—")}</td><td>${statusBadge(r.status)}</td></tr>`).join("")}
            </tbody></table>
          </div>
        </div>`).join("") || emptyState("كل البيانات مكتملة 🎉", "✅")}
    `;
  };
  load();
}
