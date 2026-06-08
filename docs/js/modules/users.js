/** وحدة المستخدمين (للمدير) */
import { API } from "../api.js";
import { esc, fmtDateTime, field, spinner, emptyState, modal, closeModal, confirmDialog, toast, ROLE_LABELS } from "../ui.js";

const DEPARTMENTS = ["الإدارة", "اللوجستك", "التخليص الكمركي", "النقل", "الحسابات", "تقنية المعلومات", "أخرى"];

export async function renderUsers(root, app) {
  if (!app.can("manageUsers")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `
    <div class="page-head">
      <h1>المستخدمون</h1>
      <div class="page-actions"><button class="btn btn-primary" id="add-user">+ مستخدم جديد</button></div>
    </div>
    <div class="card"><div class="card-body" id="users-list">${spinner()}</div></div>`;

  document.getElementById("add-user").onclick = () => userForm(null, () => load());

  const load = async () => {
    const box = document.getElementById("users-list");
    try {
      const data = await API.listUsers();
      box.innerHTML = `
        <table class="table">
          <thead><tr><th>الاسم</th><th>المستخدم</th><th>الدور</th><th>القسم</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            ${data.users.map((u) => `
              <tr class="${u.active ? "" : "row-inactive"}">
                <td><strong>${esc(u.full_name)}</strong></td>
                <td>${esc(u.username)}</td>
                <td><span class="badge badge-blue">${esc(ROLE_LABELS[u.role] || u.role)}</span></td>
                <td>${esc(u.department || "—")}</td>
                <td>${u.last_login ? fmtDateTime(u.last_login) : "—"}</td>
                <td>${u.active ? '<span class="badge badge-green">نشط</span>' : '<span class="badge badge-red">معطّل</span>'}</td>
                <td class="row-actions">
                  <button class="icon-btn" data-edit="${u.id}" title="تعديل">✏️</button>
                  <button class="icon-btn" data-pwd="${u.id}" title="كلمة مرور">🔑</button>
                  ${u.active ? `<button class="icon-btn" data-del="${u.id}" title="تعطيل">🚫</button>` : ""}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
        const u = data.users.find((x) => x.id == b.dataset.edit);
        userForm(u, () => load());
      });
      box.querySelectorAll("[data-pwd]").forEach((b) => b.onclick = () => resetPwdForm(b.dataset.pwd));
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
        confirmDialog("تعطيل هذا المستخدم؟", async () => {
          try { await API.deactivateUser(b.dataset.del); toast("تم التعطيل", "success"); load(); }
          catch (e) { toast(e.message, "error"); }
        }, { danger: true });
      });
    } catch (e) { box.innerHTML = emptyState("تعذّر التحميل: " + e.message, "⚠️"); }
  };
  load();
}

function userForm(user, onDone) {
  const u = user || {};
  const roleOpts = Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l }));
  const deptOpts = DEPARTMENTS.map((d) => ({ value: d, label: d }));
  modal(user ? "تعديل مستخدم" : "مستخدم جديد", `
    <form id="user-form">
      ${field("الاسم الكامل", "full_name", u.full_name, { required: true })}
      <div class="form-grid">
        ${field("اسم المستخدم", "username", u.username, { required: !user })}
        ${field("الدور", "role", u.role || "logistics", { options: roleOpts })}
        ${field("القسم", "department", u.department || "اللوجستك", { options: deptOpts })}
        ${field("البريد", "email", u.email, { type: "email" })}
        ${field("الهاتف", "phone", u.phone)}
        ${!user ? field("كلمة المرور", "password", "", { type: "password", required: true, placeholder: "8 أحرف فأكثر" }) : ""}
      </div>
      ${user ? field("الحالة", "active", u.active ? "1" : "0", { options: [{ value: "1", label: "نشط" }, { value: "0", label: "معطّل" }] }) : ""}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${user ? "حفظ" : "إنشاء"}</button>
        <button type="button" class="btn btn-ghost" id="user-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("user-cancel").onclick = closeModal;
  if (user) document.querySelector('#user-form [name=username]').setAttribute("readonly", "true");
  document.getElementById("user-form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    if (body.active != null) body.active = body.active === "1";
    try {
      if (user) { delete body.username; await API.updateUser(user.id, body); }
      else await API.createUser(body);
      toast("تم الحفظ", "success"); closeModal(); onDone();
    } catch (err) { toast(err.message, "error"); }
  };
}

function resetPwdForm(id) {
  modal("تعيين كلمة مرور", `
    <form id="pwd-form">
      ${field("كلمة المرور الجديدة", "new_password", "", { type: "password", required: true, placeholder: "8 أحرف فأكثر" })}
      <p class="muted">سيُطلب من المستخدم تغييرها عند أول دخول.</p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">تعيين</button>
        <button type="button" class="btn btn-ghost" id="pwd-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("pwd-cancel").onclick = closeModal;
  document.getElementById("pwd-form").onsubmit = async (e) => {
    e.preventDefault();
    const np = e.target.new_password.value;
    try { await API.resetUserPassword(id, { new_password: np }); toast("تم التعيين", "success"); closeModal(); }
    catch (err) { toast(err.message, "error"); }
  };
}
