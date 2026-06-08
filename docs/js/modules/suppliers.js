/** وحدة الموردين */
import { API } from "../api.js";
import { esc, fmtDate, field, spinner, emptyState, modal, closeModal, confirmDialog, toast } from "../ui.js";

export async function renderSuppliers(root, app) {
  root.innerHTML = `
    <div class="page-head">
      <h1>الموردون</h1>
      <div class="page-actions">
        ${app.can("writeSuppliers") ? `<button class="btn btn-primary" id="add-sup">+ مورد جديد</button>` : ""}
      </div>
    </div>
    <div class="card"><div class="card-body" id="sup-list">${spinner()}</div></div>`;

  const addBtn = document.getElementById("add-sup");
  if (addBtn) addBtn.onclick = () => supplierForm(app, null, () => load());

  const load = async () => {
    const box = document.getElementById("sup-list");
    try {
      const data = await API.listSuppliers();
      const list = data.suppliers.filter((s) => s.active);
      if (!list.length) { box.innerHTML = emptyState("لا موردين بعد", "🏭"); return; }
      box.innerHTML = `
        <table class="table">
          <thead><tr><th>الاسم</th><th>الدولة</th><th>المسؤول</th><th>الهاتف</th><th>البريد</th><th></th></tr></thead>
          <tbody>
            ${list.map((s) => `
              <tr>
                <td><strong>${esc(s.name)}</strong></td>
                <td>${esc(s.country || "—")}</td>
                <td>${esc(s.contact || "—")}</td>
                <td>${esc(s.phone || "—")}</td>
                <td>${esc(s.email || "—")}</td>
                <td class="row-actions">
                  ${app.can("writeSuppliers") ? `
                    <button class="icon-btn" data-edit="${s.id}" title="تعديل">✏️</button>
                    <button class="icon-btn" data-del="${s.id}" title="حذف">🗑️</button>` : ""}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
        const sup = list.find((x) => x.id == b.dataset.edit);
        supplierForm(app, sup, () => load());
      });
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
        confirmDialog("حذف هذا المورد؟", async () => {
          try { await API.deleteSupplier(b.dataset.del); toast("تم الحذف", "success"); load(); }
          catch (e) { toast(e.message, "error"); }
        }, { danger: true });
      });
    } catch (e) { box.innerHTML = emptyState("تعذّر التحميل: " + e.message, "⚠️"); }
  };
  load();
}

function supplierForm(app, sup, onDone) {
  const s = sup || {};
  modal(sup ? "تعديل مورد" : "مورد جديد", `
    <form id="sup-form">
      ${field("اسم المورد", "name", s.name, { required: true })}
      <div class="form-grid">
        ${field("الدولة", "country", s.country)}
        ${field("الشخص المسؤول", "contact", s.contact)}
        ${field("الهاتف", "phone", s.phone)}
        ${field("البريد", "email", s.email, { type: "email" })}
      </div>
      ${field("العنوان", "address", s.address)}
      ${field("ملاحظات", "notes", s.notes, { rows: 2 })}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${sup ? "حفظ" : "إضافة"}</button>
        <button type="button" class="btn btn-ghost" id="sup-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("sup-cancel").onclick = closeModal;
  document.getElementById("sup-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      if (sup) await API.updateSupplier(sup.id, body);
      else await API.createSupplier(body);
      toast("تم الحفظ", "success"); closeModal(); onDone();
    } catch (err) { toast(err.message, "error"); }
  };
}
