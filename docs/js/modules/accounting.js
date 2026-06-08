/** وحدة الحسابات (المالية) */
import { API } from "../api.js";
import {
  esc, fmtDate, money, field, spinner, emptyState, modal, closeModal, confirmDialog, toast,
  FINANCE_TYPE_LABELS, FINANCE_STATUS_LABELS, FINANCE_STATUS_COLORS, FINANCE_CATEGORIES, badge,
} from "../ui.js";

const CURRENCIES = ["USD", "EUR", "IQD", "AED", "TRY", "CNY"];

// بطاقة السجلات المالية داخل تفاصيل الشحنة
export function financeCard(d, app) {
  const records = d.finance || [];
  const canEdit = app.can("writeFinance");
  const cur = d.shipment.currency || "USD";
  const sum = records.reduce((a, r) => {
    if (r.type === "cost") a.cost += r.amount || 0;
    if (r.type === "payment") a.paid += r.amount || 0;
    if (r.type === "invoice") a.invoiced += r.amount || 0;
    return a;
  }, { cost: 0, paid: 0, invoiced: 0 });

  let body = `
    <div class="mini-stats">
      <div><span class="ms-l">التكاليف</span><span class="ms-v">${money(sum.cost, cur)}</span></div>
      <div><span class="ms-l">الفواتير</span><span class="ms-v">${money(sum.invoiced, cur)}</span></div>
      <div><span class="ms-l">المدفوع</span><span class="ms-v">${money(sum.paid, cur)}</span></div>
    </div>`;
  if (records.length) {
    body += `<table class="table compact" style="margin-top:14px">
      <thead><tr><th>النوع</th><th>التصنيف</th><th>الوصف</th><th>المبلغ</th><th>الحالة</th>${canEdit ? "<th></th>" : ""}</tr></thead>
      <tbody>
        ${records.map((r) => `
          <tr>
            <td>${esc(FINANCE_TYPE_LABELS[r.type] || r.type)}</td>
            <td>${esc(r.category || "—")}</td>
            <td>${esc(r.description || "—")}</td>
            <td>${money(r.amount, r.currency)}</td>
            <td>${badge(FINANCE_STATUS_LABELS[r.status] || r.status, FINANCE_STATUS_COLORS[r.status])}</td>
            ${canEdit ? `<td class="row-actions"><button class="icon-btn" data-edit-f="${r.id}">✏️</button><button class="icon-btn" data-del-f="${r.id}">🗑️</button></td>` : ""}
          </tr>`).join("")}
      </tbody>
    </table>`;
  } else {
    body += emptyState("لا سجلات مالية بعد", "💵");
  }
  return `<div class="card">
    <div class="card-head"><h2>💵 الحسابات</h2>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="add-finance">+ سجل مالي</button>` : ""}</div>
    <div class="card-body" id="finance-card-body">${body}</div>
  </div>`;
}

export function bindFinanceCard(d, app, refresh) {
  const sid = d.shipment.id;
  const add = document.getElementById("add-finance");
  if (add) add.onclick = () => financeForm(sid, null, refresh, d.shipment.currency);
  document.querySelectorAll("[data-edit-f]").forEach((b) => b.onclick = () => {
    const r = d.finance.find((x) => x.id == b.dataset.editF);
    financeForm(sid, r, refresh, d.shipment.currency);
  });
  document.querySelectorAll("[data-del-f]").forEach((b) => b.onclick = () => {
    confirmDialog("حذف السجل المالي؟", async () => {
      try { await API.deleteFinance(b.dataset.delF); toast("تم الحذف", "success"); refresh(); }
      catch (e) { toast(e.message, "error"); }
    }, { danger: true });
  });
}

function financeForm(sid, r, refresh, defCur) {
  const f = r || {};
  modal(r ? "تحديث سجل مالي" : "سجل مالي جديد", `
    <form id="finance-form">
      <div class="form-grid">
        ${field("النوع", "type", f.type || "cost", { options: Object.entries(FINANCE_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field("التصنيف", "category", f.category || "", { options: ["", ...FINANCE_CATEGORIES].map((c) => ({ value: c, label: c || "—" })) })}
        ${field("المبلغ", "amount", f.amount, { type: "number", required: true })}
        ${field("العملة", "currency", f.currency || defCur || "USD", { options: CURRENCIES })}
        ${field("الحالة", "status", f.status || "open", { options: Object.entries(FINANCE_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field("رقم المرجع", "reference_no", f.reference_no)}
        ${field("التاريخ", "record_date", f.record_date, { type: "date" })}
        ${field("تاريخ الاستحقاق", "due_date", f.due_date, { type: "date" })}
      </div>
      ${field("الوصف", "description", f.description, { rows: 2 })}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="finance-cancel">إلغاء</button>
      </div>
    </form>`, { wide: true });
  document.getElementById("finance-cancel").onclick = closeModal;
  document.getElementById("finance-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (r) await API.updateFinance(r.id, b); else await API.createFinance(sid, b);
      toast("تم الحفظ", "success"); closeModal(); refresh();
    } catch (err) { toast(err.message, "error"); }
  };
}

// صفحة نظرة عامة مالية
export async function renderAccounting(root, app) {
  root.innerHTML = `<div class="page-head"><h1>💵 الحسابات</h1></div>${spinner()}`;
  let d;
  try { d = await API.financeOverview(); }
  catch (e) { root.innerHTML = `<div class="page-head"><h1>💵 الحسابات</h1></div>` + emptyState(e.message, "⚠️"); return; }
  const t = d.totals || {};
  const cards = [
    { label: "إجمالي التكاليف", value: money(t.total_cost), icon: "📤", color: "amber" },
    { label: "إجمالي الفواتير", value: money(t.total_invoiced), icon: "🧾", color: "blue" },
    { label: "إجمالي المدفوع", value: money(t.total_paid), icon: "✅", color: "green" },
    { label: "مستحقّات مفتوحة", value: money(t.outstanding), icon: "⏳", color: "violet" },
  ];
  root.innerHTML = `
    <div class="page-head"><h1>💵 الحسابات</h1></div>
    <div class="stats-grid">
      ${cards.map((c) => `<div class="stat-card stat-${c.color}"><div class="stat-icon">${c.icon}</div>
        <div class="stat-body"><div class="stat-value" style="font-size:19px">${c.value}</div><div class="stat-label">${c.label}</div></div></div>`).join("")}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>التكاليف حسب الشحنة</h2></div><div class="card-body">
        ${(d.by_shipment || []).length ? `<table class="table compact"><thead><tr><th>المرجع</th><th>العنوان</th><th>التكلفة</th><th>المدفوع</th></tr></thead><tbody>
          ${d.by_shipment.map((s) => `<tr class="clickable" onclick="location.hash='#/shipments/${s.id}'"><td><strong>${esc(s.ref_no)}</strong></td><td>${esc(s.title)}</td><td>${money(s.cost, s.currency)}</td><td>${money(s.paid, s.currency)}</td></tr>`).join("")}
        </tbody></table>` : emptyState("لا بيانات", "💵")}
      </div></div>
      <div class="card"><div class="card-head"><h2>أحدث الحركات</h2></div><div class="card-body">
        ${(d.recent || []).length ? `<table class="table compact"><thead><tr><th>الشحنة</th><th>النوع</th><th>التصنيف</th><th>المبلغ</th></tr></thead><tbody>
          ${d.recent.map((r) => `<tr><td>${esc(r.ref_no || "—")}</td><td>${esc(FINANCE_TYPE_LABELS[r.type] || r.type)}</td><td>${esc(r.category || "—")}</td><td>${money(r.amount, r.currency)}</td></tr>`).join("")}
        </tbody></table>` : emptyState("لا حركات", "💵")}
      </div></div>
    </div>`;
}
