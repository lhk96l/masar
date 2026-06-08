/**
 * MASAR — التطبيق الرئيسي: القشرة، التوجيه، المصادقة
 */
import { CONFIG } from "./config.js";
import { API, Session, ApiError } from "./api.js";
import { esc, timeAgo, toast, modal, closeModal, field, spinner, emptyState, ROLE_LABELS, fmtDateTime } from "./ui.js";
import { renderDashboard } from "./modules/dashboard.js";
import { renderShipmentList, renderShipmentForm, renderShipmentDetail } from "./modules/shipments.js";
import { renderSuppliers } from "./modules/suppliers.js";
import { renderClients } from "./modules/clients.js";
import { renderUsers } from "./modules/users.js";
import { renderCustomsQueue } from "./modules/customs.js";
import { renderTransportQueue } from "./modules/transport.js";
import { renderAccounting } from "./modules/accounting.js";
import { renderAlerts } from "./modules/alerts.js";
import { renderCarriers } from "./modules/carriers.js";
import { renderPenalties } from "./modules/penalties.js";
import { renderCustomsOps } from "./modules/customsops.js";
import { renderReports } from "./modules/reports.js";

// مصفوفة الصلاحيات (نسخة من الخادم لإخفاء/إظهار العناصر فقط — الخادم هو الحَكم)
const PERM = {
  manageUsers: ["admin", "manager"],
  writeShipments: ["admin", "manager", "logistics"],
  deleteShipments: ["admin", "manager"],
  writeSuppliers: ["admin", "manager", "logistics"],
  writeClients: ["admin", "manager", "logistics"],
  writeCarriers: ["admin", "manager", "transport", "logistics"],
  writePenalties: ["admin", "manager", "accounting", "logistics", "customs"],
  viewReports: ["admin", "manager", "accounting"],
  writeDocuments: ["admin", "manager", "logistics", "customs", "transport"],
  writeCustoms: ["admin", "manager", "customs"],
  writeCustomsOps: ["admin", "manager", "customs"],
  writeTransport: ["admin", "manager", "transport"],
  writeFinance: ["admin", "manager", "accounting"],
  comment: ["admin", "manager", "logistics", "customs", "transport", "accounting"],
};

const app = {
  can(perm) {
    const u = Session.user;
    if (!u) return false;
    if (u.role === "admin") return true;
    return (PERM[perm] || []).includes(u.role);
  },
};

const NAV = [
  { hash: "#/dashboard", label: "لوحة المعلومات", icon: "📊" },
  { hash: "#/alerts", label: "التنبيهات", icon: "🔔" },
  { hash: "#/reports", label: "التقارير", icon: "📊", perm: "viewReports" },
  { hash: "#/shipments", label: "الشحنات", icon: "📦" },
  { hash: "#/customs", label: "التخليص الكمركي", icon: "🛃", perm: "writeCustoms" },
  { hash: "#/customs-ops", label: "عمليات الكمارك (CD/LB)", icon: "📜", perm: "writeCustomsOps" },
  { hash: "#/transport", label: "النقل", icon: "🚚", perm: "writeTransport" },
  { hash: "#/accounting", label: "الحسابات", icon: "💵", perm: "writeFinance" },
  { hash: "#/penalties", label: "الغرامات", icon: "⚖️", perm: "writePenalties" },
  { hash: "#/clients", label: "العملاء", icon: "🏢" },
  { hash: "#/carriers", label: "الناقلون", icon: "🚛", perm: "writeCarriers" },
  { hash: "#/suppliers", label: "الموردون", icon: "🏭" },
  { hash: "#/users", label: "المستخدمون", icon: "👥", perm: "manageUsers" },
  { hash: "#/activity", label: "سجل النشاط", icon: "🕒", perm: "manageUsers" },
];

// =====================================================================
//  الإقلاع
// =====================================================================
window.addEventListener("DOMContentLoaded", boot);
window.addEventListener("hashchange", router);

async function boot() {
  document.title = `${CONFIG.APP_NAME} — ${CONFIG.ORG_NAME}`;
  if (!Session.isAuthed) { return showAuth(); }
  // التحقق من صلاحية الجلسة
  try {
    const me = await API.me();
    Session.user = me.user;
    if (me.user.must_change) return showChangePassword(true);
    renderShell();
    router();
  } catch (e) {
    Session.clear();
    showAuth();
  }
}

// =====================================================================
//  شاشات المصادقة
// =====================================================================
async function showAuth() {
  const r = document.getElementById("app");
  // هل النظام بحاجة لإعداد أولي؟
  let needsSetup = false;
  try {
    const h = await API.health();
    // نتحقق عبر محاولة الإعداد لاحقاً؛ نعرض رابط الإعداد دائماً كخيار
  } catch {}
  r.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo"><img src="${CONFIG.LOGO}" alt="logo" onerror="this.onerror=null;this.outerHTML='🛢️'"></div>
          <h1>${CONFIG.APP_NAME}</h1>
          <p>${esc(CONFIG.ORG_NAME)}</p>
          <span class="auth-sub">نظام إدارة العمليات والشحنات</span>
        </div>
        <form id="login-form" class="auth-form">
          ${field("اسم المستخدم", "username", "", { required: true })}
          ${field("كلمة المرور", "password", "", { type: "password", required: true })}
          <button type="submit" class="btn btn-primary btn-block">دخول</button>
          <div class="auth-foot">
            <a href="#" id="setup-link">إعداد النظام لأول مرة</a>
          </div>
        </form>
      </div>
      <div class="auth-credit">تطوير: م. مهند المظفر — قسم التكنولوجيا</div>
    </div>`;

  document.getElementById("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "جارٍ الدخول...";
    const { username, password } = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await API.login({ username, password });
      Session.token = res.token; Session.user = res.user;
      if (res.user.must_change) return showChangePassword(true);
      renderShell(); location.hash = "#/dashboard"; router();
    } catch (err) {
      toast(err.message, "error"); btn.disabled = false; btn.textContent = "دخول";
    }
  };
  document.getElementById("setup-link").onclick = (e) => { e.preventDefault(); showSetup(); };
}

function showSetup() {
  modal("الإعداد الأولي للنظام", `
    <p class="muted" style="margin-bottom:14px">يُنشئ هذا حساب المدير الأول. يتطلب توكن الإعداد (SETUP_TOKEN) المضبوط على الخادم. يعمل مرة واحدة فقط.</p>
    <form id="setup-form">
      ${field("توكن الإعداد", "token", "", { required: true, type: "password" })}
      ${field("الاسم الكامل", "full_name", "", { required: true })}
      ${field("اسم المستخدم", "username", "", { required: true })}
      ${field("كلمة المرور", "password", "", { type: "password", required: true, placeholder: "8 أحرف فأكثر" })}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">إنشاء المدير</button>
        <button type="button" class="btn btn-ghost" id="setup-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("setup-cancel").onclick = closeModal;
  document.getElementById("setup-form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await API.setup(body);
      toast("تم إنشاء المدير — سجّل الدخول الآن", "success");
      closeModal();
    } catch (err) { toast(err.message, "error"); }
  };
}

function showChangePassword(forced = false) {
  const r = document.getElementById("app");
  r.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand"><div class="auth-logo">🔑</div><h1>تغيير كلمة المرور</h1>
          ${forced ? '<p class="auth-sub">مطلوب تغيير كلمة المرور قبل المتابعة</p>' : ""}</div>
        <form id="cp-form" class="auth-form">
          ${field("كلمة المرور الحالية", "old_password", "", { type: "password", required: true })}
          ${field("كلمة المرور الجديدة", "new_password", "", { type: "password", required: true, placeholder: "8 أحرف فأكثر" })}
          <button type="submit" class="btn btn-primary btn-block">حفظ</button>
        </form>
      </div>
    </div>`;
  document.getElementById("cp-form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await API.changePassword(body);
      const u = Session.user; if (u) { u.must_change = 0; Session.user = u; }
      toast("تم تغيير كلمة المرور", "success");
      renderShell(); location.hash = "#/dashboard"; router();
    } catch (err) { toast(err.message, "error"); }
  };
}

// =====================================================================
//  القشرة (الشريط الجانبي + الشريط العلوي)
// =====================================================================
function renderShell() {
  const u = Session.user;
  const navItems = NAV.filter((n) => !n.perm || app.can(n.perm))
    .map((n) => `<a href="${n.hash}" class="nav-item" data-hash="${n.hash}"><span class="nav-icon">${n.icon}</span>${n.label}</a>`)
    .join("");

  document.getElementById("app").innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="brand-logo"><img src="${CONFIG.LOGO}" alt="logo" onerror="this.onerror=null;this.outerHTML='🛢️'"></span><div><div class="brand-name">${CONFIG.APP_NAME}</div><div class="brand-org">${esc(CONFIG.ORG_NAME)}</div></div></div>
        <nav class="nav">${navItems}</nav>
        <div class="sidebar-foot">v${CONFIG.VERSION} · م. مهند المظفر</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="hamburger" id="hamburger">☰</button>
          <div class="topbar-spacer"></div>
          <button class="topbar-btn" id="notif-btn" title="الإشعارات">🔔<span class="notif-badge" id="notif-badge" hidden>0</span></button>
          <div class="user-menu">
            <button class="user-btn" id="user-btn">
              <span class="user-avatar">${esc((u.full_name || "?")[0])}</span>
              <span class="user-info"><span class="user-name">${esc(u.full_name)}</span><span class="user-role">${esc(ROLE_LABELS[u.role] || u.role)}</span></span>
            </button>
            <div class="dropdown" id="user-dropdown" hidden>
              <a href="#" id="dd-password">تغيير كلمة المرور</a>
              <a href="#" id="dd-logout">تسجيل الخروج</a>
            </div>
          </div>
        </header>
        <main class="content" id="content"></main>
      </div>
    </div>
    <div class="notif-panel" id="notif-panel" hidden></div>`;

  // التفاعلات
  document.getElementById("hamburger").onclick = () => document.getElementById("sidebar").classList.toggle("open");
  const userBtn = document.getElementById("user-btn");
  const dropdown = document.getElementById("user-dropdown");
  userBtn.onclick = (e) => { e.stopPropagation(); dropdown.hidden = !dropdown.hidden; };
  document.addEventListener("click", () => { dropdown.hidden = true; });
  document.getElementById("dd-logout").onclick = (e) => { e.preventDefault(); logout(); };
  document.getElementById("dd-password").onclick = (e) => { e.preventDefault(); showChangePassword(false); };
  document.getElementById("notif-btn").onclick = (e) => { e.stopPropagation(); toggleNotifications(); };

  loadNotifCount();
  setInterval(loadNotifCount, 60000);
}

function logout() {
  Session.clear();
  location.hash = "";
  showAuth();
}

// =====================================================================
//  الإشعارات
// =====================================================================
async function loadNotifCount() {
  if (!Session.isAuthed) return;
  try {
    const d = await API.notifications();
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    if (d.unread > 0) { badge.textContent = d.unread; badge.hidden = false; }
    else badge.hidden = true;
  } catch {}
}

async function toggleNotifications() {
  const panel = document.getElementById("notif-panel");
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = spinner();
  try {
    const d = await API.notifications();
    panel.innerHTML = `
      <div class="notif-head"><strong>الإشعارات</strong>${d.unread ? `<button class="link" id="read-all">تعليم الكل كمقروء</button>` : ""}</div>
      <div class="notif-list">
        ${d.notifications.length ? d.notifications.map((n) => `
          <a class="notif-item ${n.is_read ? "" : "unread"}" href="${esc(n.link || "#")}" data-id="${n.id}">
            <div class="notif-title">${esc(n.title)}</div>
            ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ""}
            <div class="notif-time">${timeAgo(n.created_at)}</div>
          </a>`).join("") : emptyState("لا إشعارات", "🔔")}
      </div>`;
    const ra = document.getElementById("read-all");
    if (ra) ra.onclick = async (e) => { e.preventDefault(); await API.readAllNotifications(); loadNotifCount(); toggleNotifications(); toggleNotifications(); };
    panel.querySelectorAll(".notif-item").forEach((a) => a.onclick = async () => {
      await API.readNotification(a.dataset.id).catch(() => {});
      loadNotifCount();
    });
  } catch (e) { panel.innerHTML = emptyState(e.message, "⚠️"); }
}
document.addEventListener("click", (e) => {
  const panel = document.getElementById("notif-panel");
  if (panel && !panel.hidden && !e.target.closest("#notif-panel") && !e.target.closest("#notif-btn")) panel.hidden = true;
});

// =====================================================================
//  المُوجِّه
// =====================================================================
async function router() {
  if (!Session.isAuthed) return showAuth();
  const content = document.getElementById("content");
  if (!content) { renderShell(); return router(); }

  const hash = location.hash || "#/dashboard";
  const path = hash.split("?")[0];

  // تفعيل عنصر التنقّل
  document.querySelectorAll(".nav-item").forEach((a) => {
    const h = a.dataset.hash;
    a.classList.toggle("active", path === h || path.startsWith(h + "/"));
  });
  document.getElementById("sidebar")?.classList.remove("open");

  try {
    let m;
    if (path === "#/" || path === "#/dashboard") return renderDashboard(content, app);
    if (path === "#/alerts") return renderAlerts(content, app);
    if (path === "#/reports") return renderReports(content, app);
    if (path === "#/shipments") return renderShipmentList(content, app);
    if (path === "#/shipments/new") return renderShipmentForm(content, app, null);
    if ((m = path.match(/^#\/shipments\/(\d+)\/edit$/))) return renderShipmentForm(content, app, +m[1]);
    if ((m = path.match(/^#\/shipments\/(\d+)$/))) return renderShipmentDetail(content, app, +m[1]);
    if (path === "#/customs-ops") return renderCustomsOps(content, app);
    if (path === "#/customs") return renderCustomsQueue(content, app);
    if (path === "#/transport") return renderTransportQueue(content, app);
    if (path === "#/accounting") return renderAccounting(content, app);
    if (path === "#/clients") return renderClients(content, app);
    if (path === "#/carriers") return renderCarriers(content, app);
    if (path === "#/penalties") return renderPenalties(content, app);
    if (path === "#/suppliers") return renderSuppliers(content, app);
    if (path === "#/users") return renderUsers(content, app);
    if (path === "#/activity") return renderActivity(content, app);
    content.innerHTML = emptyState("الصفحة غير موجودة", "🔍");
  } catch (e) {
    content.innerHTML = emptyState("خطأ: " + e.message, "⚠️");
  }
}

// =====================================================================
//  سجل النشاط
// =====================================================================
async function renderActivity(root, app) {
  if (!app.can("manageUsers")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `<div class="page-head"><h1>سجل النشاط</h1></div><div class="card"><div class="card-body" id="act-box">${spinner()}</div></div>`;
  const box = document.getElementById("act-box");
  const actionLabel = {
    create: "إنشاء", update: "تحديث", delete: "حذف", login: "دخول", login_failed: "محاولة دخول فاشلة",
    status_change: "تغيير حالة", comment: "تعليق", upload: "رفع مستند", setup: "إعداد",
    change_password: "تغيير كلمة مرور", reset_password: "تعيين كلمة مرور", deactivate: "تعطيل",
  };
  const entityLabel = { shipment: "شحنة", supplier: "مورد", user: "مستخدم", document: "مستند" };
  try {
    const d = await API.activity("?limit=150");
    if (!d.activity.length) { box.innerHTML = emptyState("لا نشاط", "🕒"); return; }
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>المستخدم</th><th>الإجراء</th><th>العنصر</th><th>التفاصيل</th><th>الوقت</th></tr></thead>
        <tbody>
          ${d.activity.map((a) => `
            <tr>
              <td>${esc(a.user_name || "—")}</td>
              <td>${esc(actionLabel[a.action] || a.action)}</td>
              <td>${esc(entityLabel[a.entity_type] || a.entity_type || "—")}${a.entity_id ? " #" + a.entity_id : ""}</td>
              <td>${esc(a.details || "—")}</td>
              <td class="muted">${fmtDateTime(a.created_at)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
}
