/** وحدة النقل */
import { API } from "../api.js";
import {
  esc, fmtDate, money, field, spinner, emptyState, modal, closeModal, confirmDialog, toast,
  TRANSPORT_LABELS, TRANSPORT_COLORS, badge,
} from "../ui.js";

const CURRENCIES = ["USD", "EUR", "IQD", "AED", "TRY", "CNY"];

// بطاقة أوامر النقل داخل تفاصيل الشحنة
export function transportCard(d, app) {
  const orders = d.transport || [];
  const canEdit = app.can("writeTransport");
  let body;
  if (!orders.length) {
    body = emptyState("لا أوامر نقل بعد", "🚚");
  } else {
    body = `<div class="stack-list">
      ${orders.map((t) => `
        <div class="op-item">
          <div class="op-head">
            <strong>${esc(t.truck_no || "بدون رقم")}</strong>
            ${badge(TRANSPORT_LABELS[t.status] || t.status, TRANSPORT_COLORS[t.status])}
            ${canEdit ? `<span class="op-actions"><button class="icon-btn" data-edit-t="${t.id}">✏️</button><button class="icon-btn" data-del-t="${t.id}">🗑️</button></span>` : ""}
          </div>
          <div class="op-meta">
            ${t.driver_name ? `🧑‍✈️ ${esc(t.driver_name)} ${t.driver_phone ? "· " + esc(t.driver_phone) : ""}<br>` : ""}
            ${t.carrier ? `الناقل: ${esc(t.carrier)} · ` : ""}${t.delivery_location ? "إلى: " + esc(t.delivery_location) : ""}
            ${t.cost ? `<br>الكلفة: ${money(t.cost, t.currency)}` : ""}
            ${t.dispatch_date ? `<br>الإرسال: ${fmtDate(t.dispatch_date)}` : ""}${t.delivery_date ? ` · التسليم: ${fmtDate(t.delivery_date)}` : ""}
          </div>
        </div>`).join("")}
    </div>`;
  }
  return `<div class="card">
    <div class="card-head"><h2>🚚 النقل</h2>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="add-transport">+ أمر نقل</button>` : ""}</div>
    <div class="card-body" id="transport-card-body">${body}</div>
  </div>`;
}

export function bindTransportCard(d, app, refresh) {
  const sid = d.shipment.id;
  const add = document.getElementById("add-transport");
  if (add) add.onclick = () => transportForm(sid, null, refresh);
  document.querySelectorAll("[data-edit-t]").forEach((b) => b.onclick = () => {
    const t = d.transport.find((x) => x.id == b.dataset.editT);
    transportForm(sid, t, refresh);
  });
  document.querySelectorAll("[data-del-t]").forEach((b) => b.onclick = () => {
    confirmDialog("حذف أمر النقل؟", async () => {
      try { await API.deleteTransport(b.dataset.delT); toast("تم الحذف", "success"); refresh(); }
      catch (e) { toast(e.message, "error"); }
    }, { danger: true });
  });
}

function transportForm(sid, t, refresh) {
  const o = t || {};
  modal(t ? "تحديث أمر النقل" : "أمر نقل جديد", `
    <form id="transport-form">
      <div class="form-grid">
        ${field("رقم الشاحنة", "truck_no", o.truck_no)}
        ${field("اسم السائق", "driver_name", o.driver_name)}
        ${field("هاتف السائق", "driver_phone", o.driver_phone)}
        ${field("شركة النقل", "carrier", o.carrier)}
        ${field("موقع الاستلام", "pickup_location", o.pickup_location)}
        ${field("موقع التسليم", "delivery_location", o.delivery_location)}
        ${field("تاريخ الإرسال", "dispatch_date", o.dispatch_date, { type: "date" })}
        ${field("تاريخ التسليم", "delivery_date", o.delivery_date, { type: "date" })}
        ${field("الكلفة", "cost", o.cost, { type: "number" })}
        ${field("العملة", "currency", o.currency || "USD", { options: CURRENCIES })}
        ${field("الحالة", "status", o.status || "assigned", { options: Object.entries(TRANSPORT_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field("الشاحنات المحجوزة (المقطوعة)", "booked_trailers", o.booked_trailers, { type: "number" })}
        ${field("تاريخ إرجاع الحاوية", "container_return_date", o.container_return_date, { type: "date" })}
        ${field("استلام EIR؟", "eir_received", o.eir_received ? "1" : "0", { options: [{ value: "0", label: "لا" }, { value: "1", label: "نعم" }] })}
        ${field("في الخزن؟", "in_storage", o.in_storage ? "1" : "0", { options: [{ value: "0", label: "لا" }, { value: "1", label: "نعم" }] })}
      </div>
      ${field("ملاحظات", "notes", o.notes, { rows: 2 })}
      <p class="muted">«في الطريق» تنقل الشحنة لمرحلة النقل، و«تم التسليم» تنقلها لمرحلة التسليم.</p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="transport-cancel">إلغاء</button>
      </div>
    </form>`, { wide: true });
  document.getElementById("transport-cancel").onclick = closeModal;
  document.getElementById("transport-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (t) await API.updateTransport(t.id, b); else await API.createTransport(sid, b);
      toast("تم الحفظ", "success"); closeModal(); refresh();
    } catch (err) { toast(err.message, "error"); }
  };
}

// صفحة طابور النقل
export async function renderTransportQueue(root, app) {
  root.innerHTML = `<div class="page-head"><h1>🚚 النقل</h1></div><div class="card"><div class="card-body" id="tq">${spinner()}</div></div>`;
  const box = document.getElementById("tq");
  try {
    const d = await API.transportQueue();
    if (!d.queue.length) { box.innerHTML = emptyState("لا شحنات جاهزة للنقل", "✅"); return; }
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>المرجع</th><th>العنوان</th><th>الوجهة</th><th>الشاحنة</th><th>السائق</th><th>الحالة</th></tr></thead>
        <tbody>
          ${d.queue.map((s) => `
            <tr class="clickable" onclick="location.hash='#/shipments/${s.id}'">
              <td><strong>${esc(s.ref_no)}</strong></td>
              <td>${esc(s.title)}</td>
              <td>${esc(s.delivery_location || s.destination || "—")}</td>
              <td>${esc(s.truck_no || "—")}</td>
              <td>${esc(s.driver_name || "—")}${s.driver_phone ? " · " + esc(s.driver_phone) : ""}</td>
              <td>${s.transport_status ? badge(TRANSPORT_LABELS[s.transport_status] || s.transport_status, TRANSPORT_COLORS[s.transport_status]) : '<span class="badge badge-gray">لم يُعيّن</span>'}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
}
