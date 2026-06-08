/** وحدة الغرامات (غرامات الخطوط الملاحية) */
import { API } from "../api.js";
import { esc, fmtDate, money, field, spinner, emptyState, modal, closeModal, confirmDialog, toast } from "../ui.js";

const CURRENCIES = ["IQD", "USD", "EUR", "AED"];

// صفحة الغرامات
export async function renderPenalties(root, app) {
  if (!app.can("writePenalties")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `
    <div class="page-head"><h1>⚖️ الغرامات</h1>
      <div class="page-actions"><button class="btn btn-primary" id="add-pen">+ غرامة جديدة</button></div>
    </div>
    <div id="pen-summary"></div>
    <div class="card"><div class="card-body" id="pen-list">${spinner()}</div></div>`;
  document.getElementById("add-pen").onclick = () => penaltyForm(null, () => load());
  const load = async () => {
    const box = document.getElementById("pen-list");
    try {
      const d = await API.listPenalties();
      const sum = Object.entries(d.by_currency || {}).map(([c, v]) => `${money(v, c)}`).join(" · ") || "0";
      document.getElementById("pen-summary").innerHTML = `<div class="alert alert-danger" style="margin-bottom:16px">إجمالي الغرامات: <strong>${sum}</strong> عبر ${d.total} سجل</div>`;
      if (!d.penalties.length) { box.innerHTML = emptyState("لا غرامات مسجّلة", "✅"); return; }
      box.innerHTML = `<table class="table"><thead><tr><th>الشحنة</th><th>العميل</th><th>الخط الملاحي</th><th>المبلغ</th><th>التقديم</th><th></th></tr></thead><tbody>
        ${d.penalties.map((p) => `<tr>
          <td>${p.shipment_id ? `<a class="link" href="#/shipments/${p.shipment_id}">${esc(p.shipment_ref_no || p.shipment_ref || "—")}</a>` : esc(p.shipment_ref || "—")}</td>
          <td>${esc(p.client || "—")}</td>
          <td>${esc(p.shipping_line || "—")}${p.agent ? " / " + esc(p.agent) : ""}</td>
          <td><strong>${money(p.penalty_amount, p.currency)}</strong></td>
          <td>${fmtDate(p.submission_date)}</td>
          <td class="row-actions"><button class="icon-btn" data-edit="${p.id}">✏️</button><button class="icon-btn" data-del="${p.id}">🗑️</button></td>
        </tr>`).join("")}</tbody></table>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => penaltyForm(d.penalties.find((x) => x.id == b.dataset.edit), () => load()));
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("حذف الغرامة؟", async () => {
        try { await API.deletePenalty(b.dataset.del); toast("تم الحذف", "success"); load(); } catch (e) { toast(e.message, "error"); }
      }, { danger: true }));
    } catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
  };
  load();
}

export function penaltyForm(p, onDone, presetRef) {
  const o = p || (presetRef ? { shipment_ref: presetRef } : {});
  modal(p ? "تعديل غرامة" : "غرامة جديدة", `
    <form id="pen-form">
      <div class="form-grid">
        ${field("رقم الشحنة (Ref)", "shipment_ref", o.shipment_ref, { placeholder: "Lot-B9-..." })}
        ${field("العميل", "client", o.client)}
        ${field("الخط الملاحي", "shipping_line", o.shipping_line)}
        ${field("الوكالة البحرية", "agent", o.agent)}
        ${field("نوع الإدخال", "type_of_entry", o.type_of_entry, { placeholder: "DDP / Permanent" })}
        ${field("المبلغ", "penalty_amount", o.penalty_amount, { type: "number", required: true })}
        ${field("العملة", "currency", o.currency || "IQD", { options: CURRENCIES })}
        ${field("تاريخ التقديم", "submission_date", o.submission_date, { type: "date" })}
        ${field("المسؤول (PIC)", "pic", o.pic)}
      </div>
      ${field("ملاحظات", "notes", o.notes, { rows: 2 })}
      <div class="form-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" id="pen-cancel">إلغاء</button></div>
    </form>`, { wide: true });
  document.getElementById("pen-cancel").onclick = closeModal;
  document.getElementById("pen-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { if (p) await API.updatePenalty(p.id, b); else await API.createPenalty(b); toast("تم الحفظ", "success"); closeModal(); onDone(); }
    catch (err) { toast(err.message, "error"); }
  };
}
