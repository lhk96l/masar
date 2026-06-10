/**
 * أدوات الواجهة المشتركة: تنسيق، تسميات، نوافذ، تنبيهات
 */

// ---- حماية من XSS ----
export function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---- التواريخ ----
export function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s.includes("T") || s.includes(" ") ? s.replace(" ", "T") + (s.includes("Z") ? "" : "Z") : s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString("ar", { year: "numeric", month: "2-digit", day: "2-digit" });
}
export function fmtDateTime(s) {
  if (!s) return "—";
  const d = new Date(s.includes("T") || s.includes(" ") ? s.replace(" ", "T") + (s.includes("Z") ? "" : "Z") : s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleString("ar", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function timeAgo(s) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + (s.includes("Z") ? "" : "Z"));
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} يوم`;
  return fmtDate(s);
}
export function money(amount, currency = "USD") {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (isNaN(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${esc(currency)}`;
}

// ---- التسميات ----
export const STATUS_LABELS = {
  draft: "مسودة", opened: "مفتوحة", at_port: "في الميناء",
  customs_clearance: "تخليص كمركي", in_transport: "قيد النقل",
  delivered: "تم التسليم", closed: "مغلقة", cancelled: "ملغاة",
};
export const STATUS_COLORS = {
  draft: "gray", opened: "blue", at_port: "cyan", customs_clearance: "amber",
  in_transport: "violet", delivered: "green", closed: "slate", cancelled: "red",
};
export const STATUS_FLOW = ["opened", "at_port", "customs_clearance", "in_transport", "delivered", "closed"];

export const PRIORITY_LABELS = { low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة" };
export const PRIORITY_COLORS = { low: "slate", normal: "blue", high: "amber", urgent: "red" };

export const ROLE_LABELS = {
  admin: "مدير النظام", manager: "مدير", logistics: "لوجستك",
  customs: "تخليص كمركي", transport: "نقل", accounting: "حسابات", viewer: "مشاهد",
};
export const MODE_LABELS = { sea: "بحري", land: "بري", air: "جوي" };
export const IMPORT_TYPE_LABELS = {
  permanent: "دائمي", ddp: "DDP", temporary: "مؤقت", reexport: "إعادة تصدير",
  import_license: "إجازة استيراد", renewal: "تجديد", courier: "بريد سريع",
};
// خطوط ملاحية شائعة (اقتراحات — الحقل يبقى حرّاً)
export const SHIPPING_LINES = ["AL RASHID", "MSC", "GOLDEN MASTS", "CMA", "CMA CGM", "EVERGREEN", "GEZAIRI", "COSCO", "MAERSK", "HAPAG-LLOYD", "UASC", "PIL", "AL MUSHTARAKA"];
export const DOC_TYPES = {
  invoice: "فاتورة تجارية", bl: "بوليصة شحن", coo: "شهادة منشأ",
  packing_list: "قائمة تعبئة", customs_decl: "بيان كمركي", lc: "اعتماد مستندي", other: "أخرى",
};

// التخليص الكمركي
export const CLEARANCE_LABELS = {
  pending: "بانتظار", submitted: "مُقدّم", under_review: "قيد المراجعة",
  cleared: "مُخلَّص", held: "محتجز",
};
export const CLEARANCE_COLORS = {
  pending: "gray", submitted: "blue", under_review: "amber", cleared: "green", held: "red",
};
// النقل
export const TRANSPORT_LABELS = {
  assigned: "مُعيّن", dispatched: "صدر", in_transit: "في الطريق",
  delivered: "تم التسليم", cancelled: "ملغى",
};
export const TRANSPORT_COLORS = {
  assigned: "blue", dispatched: "cyan", in_transit: "violet", delivered: "green", cancelled: "red",
};
// الحسابات
export const FINANCE_TYPE_LABELS = { cost: "تكلفة", invoice: "فاتورة", payment: "دفعة" };
export const FINANCE_STATUS_LABELS = { open: "مفتوح", paid: "مدفوع", partial: "جزئي", overdue: "متأخر" };
export const FINANCE_STATUS_COLORS = { open: "amber", paid: "green", partial: "blue", overdue: "red" };
export const FINANCE_CATEGORIES = ["رسوم كمركية", "أجور نقل", "شحن بحري", "تأمين", "تخزين/أرضيات", "عمولة تخليص", "بضاعة", "أخرى"];

export function badge(label, color) {
  return `<span class="badge badge-${color || "gray"}">${esc(label)}</span>`;
}

// تسميات عربية لأسماء الحقول (لعرض التغييرات بوضوح)
export const ENTITY_LABELS = { shipment: "شحنة", customs_op: "عملية كمركية", penalty: "غرامة", transport: "أمر نقل" };
export const FIELD_LABELS = {
  title:"العنوان", status:"الحالة", importation_type:"نوع الاستيراد", transport_mode:"وسيلة النقل",
  shipping_line:"الخط الملاحي", shipping_agent:"الوكالة", vessel_name:"الباخرة", destination:"الوجهة",
  bl_no:"بوليصة الشحن", container_no:"الحاوية", goods_description:"وصف البضاعة", call_off:"Call Off",
  call_off_date:"تاريخ Call Off", eta:"ETA", etd:"ETD", vessel_ata:"وصول الباخرة", priority:"الأولوية",
  docs_submission_date:"تقديم المستندات", do1_date:"أمر التسليم 1", do2_date:"أمر التسليم 2", do2_no:"رقم DO2",
  trailer_booking_date:"حجز الشاحنة", trailer_entry_date:"دخول الشاحنة", loading_date:"التحميل",
  releasing_date:"الفسح", arrival_site_date:"الوصول للموقع", offloading_pod_date:"التفريغ/POD",
  return_token_date:"إرجاع التوكن", cc_receipt_date:"وصل التخليص", finance_settlement_date:"التسوية المالية",
  handover_account_date:"تسليم للحسابات", accounting_invoice_date:"فاتورة العميل",
  cont_20std:"20 STD", cont_20fr:"20 FR", cont_20ot:"20 OT", cont_40std:"40 STD", cont_40fr:"40 FR",
  cont_40ot:"40 OT", cont_45:"45", lcl:"LCL", roro:"RORO", cbm:"CBM", weight_kg:"الوزن", total_pkgs:"الطرود",
  total_trailers:"الشاحنات", packaging_type:"التغليف", sl_deposit:"الوديعة", sl_deducted:"المخصوم",
  sl_returned:"المُعاد", deposit_currency:"عملة الوديعة", deposit_receipt_date:"وصل الوديعة", notes:"ملاحظات",
  cd_no:"رقم CD", cd_new_expire:"انتهاء CD", lb_no:"رقم LB", lb_new_expire:"انتهاء LB", job_type:"نوع العملية",
  penalty_amount:"مبلغ الغرامة", agent:"الوكالة", carrier:"الناقل", booked_trailers:"الشاحنات المحجوزة",
  container_return_date:"إرجاع الحاوية", pre_alert_date:"Pre-alert", exemption_approval:"موافقة الإعفاء",
};
export function fieldLabel(k){ return FIELD_LABELS[k] || k; }

// أنواع الحاويات (المرحلة 3) — مع معامل TEU لحساب المكافئ
export const CONTAINER_TYPES = [
  { key: "cont_20std", label: "20 STD", teu: 1 },
  { key: "cont_20fr", label: "20 FR", teu: 1 },
  { key: "cont_20ot", label: "20 OT", teu: 1 },
  { key: "cont_40std", label: "40 STD", teu: 2 },
  { key: "cont_40fr", label: "40 FR", teu: 2 },
  { key: "cont_40ot", label: "40 OT", teu: 2 },
  { key: "cont_45", label: "45", teu: 2.25 },
  { key: "lcl", label: "LCL", teu: 0 },
  { key: "roro", label: "RORO", teu: 0 },
];
export const CARRIER_KIND_LABELS = { own: "سيارات الشركة", subcontractor: "ناقل خارجي" };

// المحطات الزمنية للشحنة (بالترتيب) — المرحلة 2
export const MILESTONES = [
  { key: "call_off_date", label: "Call Off" },
  { key: "etd", label: "مغادرة (ETD)" },
  { key: "eta", label: "وصول متوقع (ETA)" },
  { key: "vessel_ata", label: "وصول الباخرة (ATA)" },
  { key: "docs_submission_date", label: "تقديم المستندات" },
  { key: "do1_date", label: "أمر التسليم الأول" },
  { key: "do2_date", label: "أمر التسليم الثاني" },
  { key: "trailer_booking_date", label: "حجز الشاحنة" },
  { key: "trailer_entry_date", label: "دخول الشاحنة" },
  { key: "loading_date", label: "التحميل" },
  { key: "releasing_date", label: "الفسح/التخريج" },
  { key: "arrival_site_date", label: "الوصول للموقع" },
  { key: "offloading_pod_date", label: "التفريغ/POD" },
  { key: "return_token_date", label: "إرجاع التوكن" },
  { key: "cc_receipt_date", label: "وصل التخليص (CC)" },
  { key: "handover_account_date", label: "تسليم للحسابات" },
  { key: "finance_settlement_date", label: "التسوية المالية" },
  { key: "accounting_invoice_date", label: "فاتورة العميل" },
];
// الحقول القابلة للتحرير في بطاقة المحطات (تُرسل لـ /milestones)
export const MILESTONE_EDITABLE = [
  "docs_submission_date", "do1_date", "do2_date", "do2_no", "trailer_booking_date",
  "trailer_entry_date", "loading_date", "releasing_date", "arrival_site_date",
  "offloading_pod_date", "return_token_date", "cc_receipt_date",
  "finance_settlement_date", "handover_account_date", "accounting_invoice_date",
];

export function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  const color = STATUS_COLORS[status] || "gray";
  return `<span class="badge badge-${color}">${esc(label)}</span>`;
}
export function priorityBadge(p) {
  const label = PRIORITY_LABELS[p] || p;
  const color = PRIORITY_COLORS[p] || "slate";
  return `<span class="badge badge-${color}">${esc(label)}</span>`;
}

// ---- التنبيهات (Toast) ----
export function toast(message, type = "info") {
  let wrap = document.getElementById("toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 4000);
}

// ---- النوافذ المنبثقة (Modal) ----
export function modal(title, contentHTML, { wide = false } = {}) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal ${wide ? "modal-wide" : ""}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="modal-close" aria-label="إغلاق">&times;</button>
      </div>
      <div class="modal-body">${contentHTML}</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".modal-close").onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  document.addEventListener("keydown", escClose);
  return overlay;
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
export function closeModal() {
  const o = document.getElementById("modal-overlay");
  if (o) o.remove();
  document.removeEventListener("keydown", escClose);
}

export function confirmDialog(message, onConfirm, { danger = false } = {}) {
  modal("تأكيد", `
    <p style="margin-bottom:20px">${esc(message)}</p>
    <div class="form-actions">
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="cf-yes">تأكيد</button>
      <button class="btn btn-ghost" id="cf-no">إلغاء</button>
    </div>`);
  document.getElementById("cf-no").onclick = closeModal;
  document.getElementById("cf-yes").onclick = async () => { closeModal(); await onConfirm(); };
}

// ---- مساعد: بناء عناصر النموذج ----
export function field(label, name, value = "", { type = "text", required = false, options = null, placeholder = "", rows = 0 } = {}) {
  const req = required ? '<span class="req">*</span>' : "";
  let input;
  if (options) {
    const opts = options.map((o) => {
      const v = typeof o === "object" ? o.value : o;
      const l = typeof o === "object" ? o.label : o;
      const sel = String(v) === String(value) ? "selected" : "";
      return `<option value="${esc(v)}" ${sel}>${esc(l)}</option>`;
    }).join("");
    input = `<select name="${name}" ${required ? "required" : ""}>${opts}</select>`;
  } else if (rows) {
    input = `<textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
  } else {
    input = `<input type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? "required" : ""}>`;
  }
  return `<div class="field"><label>${esc(label)} ${req}</label>${input}</div>`;
}

// تصدير CSV (يفتح في Excel بترميز عربي صحيح عبر BOM)
export function exportCSV(filename, columns, rows) {
  const cell = (v) => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [columns.map((c) => cell(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function spinner() {
  return `<div class="loading"><div class="spinner"></div></div>`;
}

export function emptyState(text, icon = "📭") {
  return `<div class="empty"><div class="empty-icon">${icon}</div><p>${esc(text)}</p></div>`;
}
