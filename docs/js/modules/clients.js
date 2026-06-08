/** وحدة العملاء (شركات النفط المخدومة) */
import { API } from "../api.js";
import { esc, field, spinner, emptyState, modal, closeModal, confirmDialog, toast } from "../ui.js";

export async function renderClients(root, app) {
  root.innerHTML = `
    <div class="page-head">
      <h1>العملاء</h1>
      <div class="page-actions">
        ${app.can("writeClients") ? `<button class="btn btn-primary" id="add-client">+ عميل جديد</button>` : ""}
      </div>
    </div>
    <div class="card"><div class="card-body" id="cl-list">${spinner()}</div></div>`;

  const addBtn = document.getElementById("add-client");
  if (addBtn) addBtn.onclick = () => clientForm(app, null, () => load());

  const load = async () => {
    const box = document.getElementById("cl-list");
    try {
      const data = await API.listClients();
      const list = data.clients.filter((c) => c.active);
      if (!list.length) { box.innerHTML = emptyState("لا عملاء بعد", "🏢"); return; }
      box.innerHTML = `
        <table class="table">
          <thead><tr><th>العميل</th><th>الرمز</th><th>المسؤول</th><th>الهاتف</th><th>البريد</th><th></th></tr></thead>
          <tbody>
            ${list.map((c) => `
              <tr>
                <td><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.code || "—")}</td>
                <td>${esc(c.contact || "—")}</td>
                <td>${esc(c.phone || "—")}</td>
                <td>${esc(c.email || "—")}</td>
                <td class="row-actions">
                  ${app.can("writeClients") ? `
                    <button class="icon-btn" data-edit="${c.id}" title="تعديل">✏️</button>
                    <button class="icon-btn" data-del="${c.id}" title="حذف">🗑️</button>` : ""}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
        const cl = list.find((x) => x.id == b.dataset.edit);
        clientForm(app, cl, () => load());
      });
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
        confirmDialog("حذف هذا العميل؟", async () => {
          try { await API.deleteClient(b.dataset.del); toast("تم الحذف", "success"); load(); }
          catch (e) { toast(e.message, "error"); }
        }, { danger: true });
      });
    } catch (e) { box.innerHTML = emptyState("تعذّر التحميل: " + e.message, "⚠️"); }
  };
  load();
}

function clientForm(app, cl, onDone) {
  const c = cl || {};
  modal(cl ? "تعديل عميل" : "عميل جديد", `
    <form id="cl-form">
      <div class="form-grid">
        ${field("اسم العميل", "name", c.name, { required: true })}
        ${field("الرمز", "code", c.code, { placeholder: "UEG, SLB..." })}
        ${field("الشخص المسؤول", "contact", c.contact)}
        ${field("الهاتف", "phone", c.phone)}
        ${field("البريد", "email", c.email, { type: "email" })}
      </div>
      ${field("العنوان", "address", c.address)}
      ${field("ملاحظات", "notes", c.notes, { rows: 2 })}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${cl ? "حفظ" : "إضافة"}</button>
        <button type="button" class="btn btn-ghost" id="cl-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("cl-cancel").onclick = closeModal;
  document.getElementById("cl-form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (cl) await API.updateClient(cl.id, body);
      else await API.createClient(body);
      toast("تم الحفظ", "success"); closeModal(); onDone();
    } catch (err) { toast(err.message, "error"); }
  };
}
