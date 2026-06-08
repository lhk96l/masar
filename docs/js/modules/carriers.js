/** وحدة الناقلين */
import { API } from "../api.js";
import { esc, field, spinner, emptyState, modal, closeModal, confirmDialog, toast, CARRIER_KIND_LABELS, badge } from "../ui.js";

export async function renderCarriers(root, app) {
  root.innerHTML = `
    <div class="page-head"><h1>الناقلون</h1>
      <div class="page-actions">${app.can("writeCarriers") ? `<button class="btn btn-primary" id="add-carrier">+ ناقل جديد</button>` : ""}</div>
    </div>
    <div class="card"><div class="card-body" id="ca-list">${spinner()}</div></div>`;
  const addBtn = document.getElementById("add-carrier");
  if (addBtn) addBtn.onclick = () => carrierForm(null, () => load());
  const load = async () => {
    const box = document.getElementById("ca-list");
    try {
      const list = (await API.listCarriers()).carriers.filter((c) => c.active);
      if (!list.length) { box.innerHTML = emptyState("لا ناقلين بعد", "🚛"); return; }
      box.innerHTML = `<table class="table"><thead><tr><th>الناقل</th><th>النوع</th><th>الهاتف</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${badge(CARRIER_KIND_LABELS[c.kind] || c.kind, c.kind === "own" ? "green" : "slate")}</td>
          <td>${esc(c.phone || "—")}</td>
          <td class="row-actions">${app.can("writeCarriers") ? `<button class="icon-btn" data-edit="${c.id}">✏️</button><button class="icon-btn" data-del="${c.id}">🗑️</button>` : ""}</td>
        </tr>`).join("")}</tbody></table>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => carrierForm(list.find((x) => x.id == b.dataset.edit), () => load()));
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("حذف الناقل؟", async () => {
        try { await API.deleteCarrier(b.dataset.del); toast("تم الحذف", "success"); load(); } catch (e) { toast(e.message, "error"); }
      }, { danger: true }));
    } catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
  };
  load();
}

function carrierForm(c, onDone) {
  const o = c || {};
  modal(c ? "تعديل ناقل" : "ناقل جديد", `
    <form id="ca-form">
      ${field("اسم الناقل", "name", o.name, { required: true })}
      <div class="form-grid">
        ${field("النوع", "kind", o.kind || "subcontractor", { options: Object.entries(CARRIER_KIND_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field("الهاتف", "phone", o.phone)}
      </div>
      ${field("ملاحظات", "notes", o.notes, { rows: 2 })}
      <div class="form-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" id="ca-cancel">إلغاء</button></div>
    </form>`);
  document.getElementById("ca-cancel").onclick = closeModal;
  document.getElementById("ca-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { if (c) await API.updateCarrier(c.id, b); else await API.createCarrier(b); toast("تم الحفظ", "success"); closeModal(); onDone(); }
    catch (err) { toast(err.message, "error"); }
  };
}
