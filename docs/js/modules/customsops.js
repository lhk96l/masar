/** وحدة عمليات الكمارك (إدارة CD/LB) */
import { API } from "../api.js";
import { esc, fmtDate, field, spinner, emptyState, modal, closeModal, confirmDialog, toast, badge } from "../ui.js";

const STATUS = { open: "مفتوحة", in_progress: "قيد التنفيذ", done: "منجزة" };
const STATUS_COLOR = { open: "amber", in_progress: "blue", done: "green" };

function expBadge(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(String(dateStr).replace(" ", "T"));
  if (isNaN(d)) return esc(dateStr);
  const left = Math.ceil((d - Date.now()) / 86400000);
  const color = left < 0 ? "red" : left <= 30 ? "amber" : "green";
  const note = left < 0 ? `منتهٍ منذ ${Math.abs(left)}ي` : `${left}ي`;
  return `${fmtDate(dateStr)} ${badge(note, color)}`;
}

export async function renderCustomsOps(root, app) {
  if (!app.can("writeCustomsOps")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `
    <div class="page-head"><h1>🛂 عمليات الكمارك (CD/LB)</h1>
      <div class="page-actions"><button class="btn btn-primary" id="add-op">+ عملية جديدة</button></div>
    </div>
    <div class="card"><div class="card-body" id="op-list">${spinner()}</div></div>`;
  let clients = [];
  try { clients = (await API.listClients()).clients.filter((c) => c.active); } catch {}
  document.getElementById("add-op").onclick = () => opForm(null, clients, () => load());
  const load = async () => {
    const box = document.getElementById("op-list");
    try {
      const ops = (await API.listCustomsOps()).operations;
      if (!ops.length) { box.innerHTML = emptyState("لا عمليات كمركية بعد", "🛂"); return; }
      box.innerHTML = `<table class="table"><thead><tr>
        <th>ABR Ref</th><th>العميل</th><th>النوع</th><th>CD</th><th>انتهاء CD</th><th>LB</th><th>انتهاء LB</th><th>الحالة</th><th></th>
      </tr></thead><tbody>
        ${ops.map((o) => `<tr>
          <td><strong>${esc(o.abr_ref || "—")}</strong></td>
          <td>${esc(o.client_name || "—")}</td>
          <td>${esc(o.job_type || "—")}</td>
          <td>${esc(o.cd_no || "—")}</td>
          <td>${expBadge(o.cd_new_expire)}</td>
          <td>${esc(o.lb_no || "—")}</td>
          <td>${expBadge(o.lb_new_expire)}</td>
          <td>${badge(STATUS[o.status] || o.status, STATUS_COLOR[o.status] || "gray")}</td>
          <td class="row-actions"><button class="icon-btn" data-edit="${o.id}">✏️</button><button class="icon-btn" data-del="${o.id}">🗑️</button></td>
        </tr>`).join("")}</tbody></table>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => opForm(ops.find((x) => x.id == b.dataset.edit), clients, () => load()));
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("حذف العملية؟", async () => {
        try { await API.deleteCustomsOp(b.dataset.del); toast("تم الحذف", "success"); load(); } catch (e) { toast(e.message, "error"); }
      }, { danger: true }));
    } catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
  };
  load();
}

function opForm(o, clients, onDone) {
  const v = o || {};
  const clientOpts = [{ value: "", label: "— اختر عميلاً —" }, ...clients.map((c) => ({ value: c.id, label: c.name }))];
  modal(o ? "تعديل عملية كمركية" : "عملية كمركية جديدة", `
    <form id="op-form">
      <div class="form-grid">
        ${field("ABR Ref", "abr_ref", v.abr_ref)}
        ${field("نوع العملية", "job_type", v.job_type, { placeholder: "CD / LB / تجديد" })}
        ${field("العميل", "client_id", v.client_id || "", { options: clientOpts })}
        ${field("المسؤول (PIC)", "pic", v.pic)}
        ${field("جهة العملية", "operation_org", v.operation_org)}
        ${field("الشركة النفطية", "oil_company", v.oil_company)}
        ${field("رقم العقد", "contract_no", v.contract_no)}
        ${field("عدد CD/LB", "qty_cdlb", v.qty_cdlb)}
      </div>
      <h3 class="section-title">المستند الكمركي (CD)</h3>
      <div class="form-grid">
        ${field("رقم CD", "cd_no", v.cd_no)}
        ${field("انتهاء CD السابق", "cd_last_expire", v.cd_last_expire, { type: "date" })}
        ${field("انتهاء CD الجديد", "cd_new_expire", v.cd_new_expire, { type: "date" })}
      </div>
      <h3 class="section-title">الكفالة (LB)</h3>
      <div class="form-grid">
        ${field("رقم LB", "lb_no", v.lb_no)}
        ${field("انتهاء LB السابق", "lb_last_expire", v.lb_last_expire, { type: "date" })}
        ${field("انتهاء LB الجديد", "lb_new_expire", v.lb_new_expire, { type: "date" })}
      </div>
      <h3 class="section-title">المتابعة</h3>
      <div class="form-grid">
        ${field("بداية العملية", "process_start_date", v.process_start_date, { type: "date" })}
        ${field("نهاية العملية", "process_end_date", v.process_end_date, { type: "date" })}
        ${field("تسليم للحسابات", "handover_account_date", v.handover_account_date, { type: "date" })}
        ${field("استلام من الحسابات", "receive_account_date", v.receive_account_date, { type: "date" })}
        ${field("فاتورة العميل", "invoice_client_date", v.invoice_client_date, { type: "date" })}
        ${field("الحالة", "status", v.status || "open", { options: Object.entries(STATUS).map(([val, l]) => ({ value: val, label: l })) })}
        ${field("سُلّم للعميل؟", "handover_to_client", v.handover_to_client ? "1" : "0", { options: [{ value: "0", label: "لا" }, { value: "1", label: "نعم" }] })}
        ${field("POD موقّع؟", "pod_signed", v.pod_signed ? "1" : "0", { options: [{ value: "0", label: "لا" }, { value: "1", label: "نعم" }] })}
      </div>
      ${field("ملاحظات", "notes", v.notes, { rows: 2 })}
      <div class="form-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" id="op-cancel">إلغاء</button></div>
    </form>`, { wide: true });
  document.getElementById("op-cancel").onclick = closeModal;
  document.getElementById("op-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { if (o) await API.updateCustomsOp(o.id, b); else await API.createCustomsOp(b); toast("تم الحفظ", "success"); closeModal(); onDone(); }
    catch (err) { toast(err.message, "error"); }
  };
}
