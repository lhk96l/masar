/** وحدة التخليص الكمركي */
import { API } from "../api.js";
import {
  esc, fmtDate, money, statusBadge, priorityBadge, field, spinner, emptyState,
  modal, closeModal, toast, CLEARANCE_LABELS, CLEARANCE_COLORS, badge,
} from "../ui.js";

const CURRENCIES = ["USD", "EUR", "IQD", "AED", "TRY", "CNY"];

// بطاقة البيان الكمركي داخل تفاصيل الشحنة
export function customsCard(d, app, refresh) {
  const c = d.customs;
  const canEdit = app.can("writeCustoms");
  let body;
  if (!c) {
    body = emptyState("لا يوجد بيان كمركي بعد", "🛃");
  } else {
    const dem = demurrage(c.port_arrival_date, c.free_days);
    body = `
      <div class="detail-grid">
        ${row("رقم البيان", c.declaration_no)}
        ${row("المركز الكمركي", c.customs_office)}
        ${row("البند الجمركي (HS)", c.hs_code)}
        ${row("الوسيط/المخلّص", c.broker_name)}
        ${row("نسبة الرسم", c.duty_rate != null ? c.duty_rate + "%" : null)}
        ${row("الرسوم الكمركية", c.duty_amount ? money(c.duty_amount, c.currency) : null)}
        ${row("الضريبة", c.tax_amount ? money(c.tax_amount, c.currency) : null)}
        ${row("رسوم أخرى", c.other_fees ? money(c.other_fees, c.currency) : null)}
        ${row("الإجمالي", c.total_fees ? `<strong>${money(c.total_fees, c.currency)}</strong>` : null, true)}
        ${row("الحالة", badge(CLEARANCE_LABELS[c.clearance_status] || c.clearance_status, CLEARANCE_COLORS[c.clearance_status]), true)}
        ${row("وصول الميناء", fmtDate(c.port_arrival_date))}
        ${row("أيام السماح", c.free_days)}
        ${row("تاريخ التخليص", fmtDate(c.cleared_date))}
      </div>
      ${c.port_arrival_date && c.clearance_status !== "cleared" ? `
        <div class="alert ${dem.demurrage_days > 0 ? "alert-danger" : "alert-info"}">
          ⏱️ مضى ${dem.days_at_port} يوم في الميناء.
          ${dem.demurrage_days > 0 ? `<strong>تجاوز السماح بـ ${dem.demurrage_days} يوم — خطر أرضيات/غرامات!</strong>` : `ضمن أيام السماح (${c.free_days || 0}).`}
        </div>` : ""}
      ${c.notes ? `<div class="detail-note">${esc(c.notes)}</div>` : ""}`;
  }
  return `<div class="card">
    <div class="card-head"><h2>🛃 البيان الكمركي</h2>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="edit-customs">${c ? "تحديث" : "+ إضافة بيان"}</button>` : ""}</div>
    <div class="card-body" id="customs-card-body">${body}</div>
  </div>`;
}

export function bindCustomsCard(d, app, refresh) {
  const btn = document.getElementById("edit-customs");
  if (btn) btn.onclick = () => customsForm(d, refresh);
}

function customsForm(d, refresh) {
  const c = d.customs || {};
  const sid = d.shipment.id;
  modal(c.id ? "تحديث البيان الكمركي" : "البيان الكمركي", `
    <form id="customs-form">
      <div class="form-grid">
        ${field("رقم البيان", "declaration_no", c.declaration_no)}
        ${field("المركز الكمركي", "customs_office", c.customs_office, { placeholder: "مثال: كمرك أم قصر" })}
        ${field("البند الجمركي (HS)", "hs_code", c.hs_code)}
        ${field("الوسيط/المخلّص", "broker_name", c.broker_name)}
        ${field("نسبة الرسم %", "duty_rate", c.duty_rate, { type: "number" })}
        ${field("العملة", "currency", c.currency || d.shipment.currency || "USD", { options: CURRENCIES })}
        ${field("الرسوم الكمركية", "duty_amount", c.duty_amount, { type: "number" })}
        ${field("الضريبة", "tax_amount", c.tax_amount, { type: "number" })}
        ${field("رسوم أخرى", "other_fees", c.other_fees, { type: "number" })}
        ${field("الإجمالي (يُحسب تلقائياً إن تُرك فارغاً)", "total_fees", c.total_fees, { type: "number" })}
        ${field("حالة التخليص", "clearance_status", c.clearance_status || "pending", { options: Object.entries(CLEARANCE_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field("تاريخ وصول الميناء", "port_arrival_date", c.port_arrival_date, { type: "date" })}
        ${field("أيام السماح", "free_days", c.free_days || 0, { type: "number" })}
        ${field("تاريخ التخليص", "cleared_date", c.cleared_date, { type: "date" })}
      </div>
      ${field("ملاحظات", "notes", c.notes, { rows: 2 })}
      <p class="muted">عند اختيار «مُخلَّص» تنتقل الشحنة تلقائياً إلى مرحلة النقل.</p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="customs-cancel">إلغاء</button>
      </div>
    </form>`, { wide: true });
  document.getElementById("customs-cancel").onclick = closeModal;
  document.getElementById("customs-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { await API.saveCustoms(sid, b); toast("تم حفظ البيان الكمركي", "success"); closeModal(); refresh(); }
    catch (err) { toast(err.message, "error"); }
  };
}

function row(label, value, strong) {
  return `<div class="dr"><span class="dr-l">${esc(label)}</span><span class="dr-v">${value != null && value !== "" ? value : "—"}</span></div>`;
}

function demurrage(portArrival, freeDays) {
  if (!portArrival) return { days_at_port: 0, demurrage_days: 0 };
  const arr = new Date(portArrival.replace(" ", "T"));
  if (isNaN(arr)) return { days_at_port: 0, demurrage_days: 0 };
  const days = Math.max(0, Math.floor((Date.now() - arr) / 86400000));
  return { days_at_port: days, demurrage_days: Math.max(0, days - (freeDays || 0)) };
}

// صفحة طابور التخليص الكمركي
export async function renderCustomsQueue(root, app) {
  root.innerHTML = `<div class="page-head"><h1>🛃 التخليص الكمركي</h1></div><div class="card"><div class="card-body" id="cq">${spinner()}</div></div>`;
  const box = document.getElementById("cq");
  try {
    const d = await API.customsQueue();
    if (!d.queue.length) { box.innerHTML = emptyState("لا شحنات بانتظار التخليص", "✅"); return; }
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>المرجع</th><th>العنوان</th><th>المورد</th><th>رقم البيان</th><th>الرسوم</th><th>أيام الميناء</th><th>الحالة</th></tr></thead>
        <tbody>
          ${d.queue.map((s) => `
            <tr class="clickable" onclick="location.hash='#/shipments/${s.id}'">
              <td><strong>${esc(s.ref_no)}</strong></td>
              <td>${esc(s.title)}</td>
              <td>${esc(s.supplier_name || "—")}</td>
              <td>${esc(s.declaration_no || "—")}</td>
              <td>${s.total_fees ? money(s.total_fees, s.currency) : "—"}</td>
              <td>${s.days_at_port}${s.demurrage_days > 0 ? ` <span class="badge badge-red">+${s.demurrage_days} أرضيات</span>` : ""}</td>
              <td>${badge(CLEARANCE_LABELS[s.clearance_status] || "بانتظار", CLEARANCE_COLORS[s.clearance_status] || "gray")}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
}
