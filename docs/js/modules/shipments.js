/** وحدة الشحنات (اللوجستك) — القائمة، النموذج، التفاصيل */
import { API } from "../api.js";
import {
  esc, fmtDate, fmtDateTime, timeAgo, money, statusBadge, priorityBadge,
  STATUS_LABELS, STATUS_FLOW, PRIORITY_LABELS, MODE_LABELS, DOC_TYPES,
  IMPORT_TYPE_LABELS, SHIPPING_LINES, MILESTONES, MILESTONE_EDITABLE, CONTAINER_TYPES,
  field, spinner, emptyState, modal, closeModal, confirmDialog, toast, exportCSV,
} from "../ui.js";
import { customsCard, bindCustomsCard } from "./customs.js";
import { transportCard, bindTransportCard } from "./transport.js";
import { financeCard, bindFinanceCard } from "./accounting.js";
import { penaltyForm } from "./penalties.js";

const INCOTERMS = ["", "FOB", "CIF", "CFR", "EXW", "DAP", "DDP", "FCA"];
const CURRENCIES = ["USD", "EUR", "IQD", "AED", "TRY", "CNY"];

// ===================== القائمة =====================
let _clientsCache = null;
export async function renderShipmentList(root, app) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const status = params.get("status") || "";
  const q = params.get("q") || "";
  const clientId = params.get("client_id") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const LIMIT = 25;

  if (!_clientsCache) { try { _clientsCache = (await API.listClients()).clients.filter((c) => c.active); } catch { _clientsCache = []; } }
  const clientOpts = _clientsCache.map((c) => `<option value="${c.id}" ${String(c.id) === clientId ? "selected" : ""}>${esc(c.name)}</option>`).join("");

  root.innerHTML = `
    <div class="page-head">
      <h1>الشحنات</h1>
      <div class="page-actions">
        <button class="btn btn-ghost" id="f-export">⬇️ تصدير Excel</button>
        ${app.can("writeShipments") ? `<a href="#/shipments/new" class="btn btn-primary">+ شحنة جديدة</a>` : ""}
      </div>
    </div>

    <div class="filters">
      <input type="search" id="f-q" placeholder="بحث: رقم، عنوان، بوليصة، حاوية..." value="${esc(q)}">
      <select id="f-client"><option value="">كل العملاء</option>${clientOpts}</select>
      <select id="f-status">
        <option value="">كل الحالات</option>
        ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === status ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <button class="btn btn-ghost" id="f-go">تصفية</button>
    </div>

    <div class="card"><div class="card-body" id="ship-list">${spinner()}</div></div>
  `;

  const goto = (p) => {
    const nq = document.getElementById("f-q").value.trim();
    const ns = document.getElementById("f-status").value;
    const nc = document.getElementById("f-client").value;
    const params = new URLSearchParams();
    if (nq) params.set("q", nq);
    if (ns) params.set("status", ns);
    if (nc) params.set("client_id", nc);
    if (p > 1) params.set("page", p);
    location.hash = `#/shipments${params.toString() ? "?" + params.toString() : ""}`;
  };
  const apply = () => goto(1);
  document.getElementById("f-go").onclick = apply;
  document.getElementById("f-q").onkeydown = (e) => { if (e.key === "Enter") apply(); };
  document.getElementById("f-status").onchange = apply;
  document.getElementById("f-client").onchange = apply;

  document.getElementById("f-export").onclick = async (e) => {
    const btn = e.target; btn.disabled = true; const old = btn.textContent; btn.textContent = "جارٍ التصدير...";
    try {
      // اجلب كل النتائج المطابقة (كل الصفحات)
      let all = [], pg = 1;
      while (true) {
        const qs = "?" + new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(clientId && { client_id: clientId }), page: String(pg), limit: "100" }).toString();
        const d = await API.listShipments(qs);
        all = all.concat(d.shipments);
        if (all.length >= d.total || !d.shipments.length) break;
        pg++;
      }
      const cols = [
        { label: "المرجع", key: "ref_no" }, { label: "العنوان", key: "title" },
        { label: "العميل", key: "client_name" }, { label: "المورد", key: "supplier_name" },
        { label: "نوع الاستيراد", get: (r) => IMPORT_TYPE_LABELS[r.importation_type] || r.importation_type || "" },
        { label: "الحالة", get: (r) => STATUS_LABELS[r.status] || r.status },
        { label: "الأولوية", get: (r) => PRIORITY_LABELS[r.priority] || r.priority },
        { label: "وسيلة النقل", get: (r) => MODE_LABELS[r.transport_mode] || r.transport_mode || "" },
        { label: "الخط الملاحي", key: "shipping_line" }, { label: "الباخرة", key: "vessel_name" },
        { label: "بوليصة الشحن", key: "bl_no" }, { label: "الحاوية", key: "container_no" },
        { label: "الوجهة", key: "destination" }, { label: "ETD", key: "etd" }, { label: "ETA", key: "eta" },
        { label: "المسؤول", key: "assigned_name" }, { label: "آخر تحديث", key: "latest_update" },
      ];
      exportCSV(`MASAR-shipments-${new Date().toISOString().slice(0, 10)}.csv`, cols, all);
      toast(`تم تصدير ${all.length} شحنة`, "success");
    } catch (err) { toast("تعذّر التصدير: " + err.message, "error"); }
    btn.disabled = false; btn.textContent = old;
  };

  const listEl = document.getElementById("ship-list");
  try {
    const qs = "?" + new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(clientId && { client_id: clientId }), page: String(page), limit: String(LIMIT) }).toString();
    const data = await API.listShipments(qs);
    if (!data.shipments.length) { listEl.innerHTML = emptyState("لا توجد شحنات مطابقة", "📦"); return; }
    const totalPages = Math.max(1, Math.ceil(data.total / LIMIT));
    const from = (page - 1) * LIMIT + 1, to = Math.min(page * LIMIT, data.total);
    listEl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>المرجع</th><th>العنوان</th><th>العميل</th><th>الوجهة</th>
          <th>الأولوية</th><th>الحالة</th><th>ETA</th><th>المسؤول</th>
        </tr></thead>
        <tbody>
          ${data.shipments.map((s) => `
            <tr class="clickable" onclick="location.hash='#/shipments/${s.id}'">
              <td><strong>${esc(s.ref_no)}</strong></td>
              <td>${esc(s.title)}</td>
              <td>${esc(s.client_name || "—")}</td>
              <td>${esc(s.destination || "—")}</td>
              <td>${priorityBadge(s.priority)}</td>
              <td>${statusBadge(s.status)}</td>
              <td>${fmtDate(s.eta)}</td>
              <td>${esc(s.assigned_name || "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="pager">
        <button class="btn btn-ghost btn-sm" id="pg-prev" ${page <= 1 ? "disabled" : ""}>← السابق</button>
        <span class="pager-info">${from}–${to} من ${data.total} · صفحة ${page}/${totalPages}</span>
        <button class="btn btn-ghost btn-sm" id="pg-next" ${page >= totalPages ? "disabled" : ""}>التالي →</button>
      </div>`;
    const prev = document.getElementById("pg-prev"); if (prev) prev.onclick = () => goto(page - 1);
    const next = document.getElementById("pg-next"); if (next) next.onclick = () => goto(page + 1);
  } catch (e) {
    listEl.innerHTML = emptyState("تعذّر التحميل: " + e.message, "⚠️");
  }
}

// ===================== النموذج (إنشاء/تعديل) =====================
export async function renderShipmentForm(root, app, id = null) {
  if (!app.can("writeShipments")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = spinner();
  let ship = {};
  let suppliers = [];
  let clients = [];
  let users = [];
  try {
    suppliers = (await API.listSuppliers()).suppliers.filter((s) => s.active);
    try { clients = (await API.listClients()).clients.filter((c) => c.active); } catch { clients = []; }
    try { users = (await API.listUsers()).users.filter((u) => u.active); } catch { users = []; }
    if (id) ship = (await API.getShipment(id)).shipment;
  } catch (e) {
    root.innerHTML = emptyState("تعذّر التحميل: " + e.message, "⚠️"); return;
  }

  const supOpts = [{ value: "", label: "— اختر مورداً —" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))];
  const clientOpts = [{ value: "", label: "— اختر عميلاً —" }, ...clients.map((c) => ({ value: c.id, label: c.name }))];
  const userOpts = [{ value: "", label: "— غير مُسند —" }, ...users.map((u) => ({ value: u.id, label: u.full_name }))];
  const importOpts = [{ value: "", label: "—" }, ...Object.entries(IMPORT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))];

  root.innerHTML = `
    <div class="page-head"><h1>${id ? "تعديل الشحنة " + esc(ship.ref_no) : "شحنة جديدة"}</h1></div>
    <form id="ship-form" class="card form">
      <div class="card-body">
        <h3 class="section-title">المعلومات الأساسية</h3>
        <div class="form-grid">
          ${field("عنوان الشحنة", "title", ship.title, { required: true, placeholder: "مثال: مضخات نفطية - دفعة 1" })}
          ${field("العميل", "client_id", ship.client_id || "", { options: clientOpts })}
          ${field("المورد", "supplier_id", ship.supplier_id || "", { options: supOpts })}
          ${field("نوع الاستيراد", "importation_type", ship.importation_type || "", { options: importOpts })}
          ${field("الأولوية", "priority", ship.priority || "normal", { options: Object.entries(PRIORITY_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
          ${field("المسؤول (PIC)", "assigned_to", ship.assigned_to || "", { options: userOpts })}
          ${field("مرجع Call Off", "call_off", ship.call_off)}
          ${field("تاريخ Call Off", "call_off_date", ship.call_off_date, { type: "date" })}
        </div>

        <h3 class="section-title">الشحن والملاحة</h3>
        <div class="form-grid">
          ${field("وسيلة النقل", "transport_mode", ship.transport_mode || "", { options: [{ value: "", label: "—" }, ...Object.entries(MODE_LABELS).map(([v, l]) => ({ value: v, label: l }))] })}
          ${field("شرط التسليم (Incoterm)", "incoterm", ship.incoterm || "", { options: INCOTERMS.map((i) => ({ value: i, label: i || "—" })) })}
          ${field("الخط الملاحي", "shipping_line", ship.shipping_line, { placeholder: SHIPPING_LINES.slice(0, 4).join("، ") })}
          ${field("الوكالة البحرية", "shipping_agent", ship.shipping_agent)}
          ${field("اسم الباخرة", "vessel_name", ship.vessel_name)}
          ${field("رقم الرحلة (VOY)", "voyage_no", ship.voyage_no)}
          ${field("الوصول الفعلي (ATA)", "vessel_ata", ship.vessel_ata, { type: "date" })}
          ${field("رقم الرصيف (Berth)", "berth_no", ship.berth_no)}
        </div>

        <h3 class="section-title">البضاعة</h3>
        <div class="form-grid">
          ${field("بلد المنشأ", "origin_country", ship.origin_country)}
          ${field("ميناء التحميل", "origin_port", ship.origin_port)}
          ${field("الوجهة", "destination", ship.destination)}
          ${field("رقم بوليصة الشحن (BL)", "bl_no", ship.bl_no)}
          ${field("رقم الحاوية", "container_no", ship.container_no)}
          ${field("الوزن (كغم)", "weight_kg", ship.weight_kg, { type: "number" })}
          ${field("الكمية", "quantity", ship.quantity, { type: "number" })}
          ${field("الوحدة", "unit", ship.unit, { placeholder: "طن / صندوق / حاوية" })}
        </div>

        <h3 class="section-title">القيمة والمواعيد</h3>
        <div class="form-grid">
          ${field("قيمة البضاعة", "goods_value", ship.goods_value, { type: "number" })}
          ${field("العملة", "currency", ship.currency || "USD", { options: CURRENCIES })}
          ${field("موعد المغادرة (ETD)", "etd", ship.etd, { type: "date" })}
          ${field("موعد الوصول (ETA)", "eta", ship.eta, { type: "date" })}
        </div>

        <h3 class="section-title">وصف وملاحظات</h3>
        ${field("وصف البضاعة", "goods_description", ship.goods_description, { rows: 2 })}
        ${field("ملاحظات", "notes", ship.notes, { rows: 2 })}
      </div>
      <div class="card-foot form-actions">
        <button type="submit" class="btn btn-primary">${id ? "حفظ التعديلات" : "إنشاء الشحنة"}</button>
        <a href="${id ? "#/shipments/" + id : "#/shipments"}" class="btn btn-ghost">إلغاء</a>
      </div>
    </form>`;

  document.getElementById("ship-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {};
    for (const [k, v] of fd.entries()) body[k] = v === "" ? null : v;
    ["client_id", "supplier_id", "assigned_to", "weight_kg", "quantity", "goods_value"].forEach((k) => {
      if (body[k] != null) body[k] = Number(body[k]);
    });
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
    try {
      if (id) { await API.updateShipment(id, body); toast("تم حفظ التعديلات", "success"); location.hash = `#/shipments/${id}`; }
      else { const r = await API.createShipment(body); toast(`تم إنشاء الشحنة ${r.ref_no}`, "success"); location.hash = `#/shipments/${r.id}`; }
    } catch (err) {
      toast(err.message, "error"); btn.disabled = false; btn.textContent = id ? "حفظ التعديلات" : "إنشاء الشحنة";
    }
  };
}

// ===================== التفاصيل =====================
export async function renderShipmentDetail(root, app, id) {
  root.innerHTML = spinner();
  let d;
  try { d = await API.getShipment(id); }
  catch (e) { root.innerHTML = emptyState("تعذّر التحميل: " + e.message, "⚠️"); return; }
  const s = d.shipment;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/shipments" class="back-link">← الشحنات</a>
        <h1>${esc(s.ref_no)} — ${esc(s.title)}</h1>
        <div class="head-meta">${statusBadge(s.status)} ${priorityBadge(s.priority)}
          <span class="muted">أُنشئت ${fmtDate(s.created_at)} بواسطة ${esc(s.created_name || "—")}</span></div>
        ${s.latest_update ? `<div class="latest-update">📣 <strong>آخر تحديث:</strong> ${esc(s.latest_update)} <span class="muted">(${timeAgo(s.latest_update_at)})</span></div>` : ""}
      </div>
      <div class="page-actions">
        ${app.can("writeShipments") ? `<a href="#/shipments/${id}/edit" class="btn btn-ghost">تعديل</a>` : ""}
        ${app.can("deleteShipments") ? `<button class="btn btn-danger" id="del-ship">حذف</button>` : ""}
      </div>
    </div>

    ${renderStatusFlow(s, app)}

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>تفاصيل الشحنة</h2></div>
        <div class="card-body">
          <div class="detail-grid">
            ${detailRow("العميل", s.client_name)}
            ${detailRow("المورد", s.supplier_name)}
            ${detailRow("نوع الاستيراد", IMPORT_TYPE_LABELS[s.importation_type] || s.importation_type)}
            ${detailRow("Call Off", s.call_off)}
            ${detailRow("تاريخ Call Off", fmtDate(s.call_off_date))}
            ${detailRow("بلد المنشأ", s.origin_country)}
            ${detailRow("ميناء التحميل", s.origin_port)}
            ${detailRow("الوجهة", s.destination)}
            ${detailRow("وسيلة النقل", MODE_LABELS[s.transport_mode] || s.transport_mode)}
            ${detailRow("شرط التسليم", s.incoterm)}
            ${detailRow("الخط الملاحي", s.shipping_line)}
            ${detailRow("الوكالة البحرية", s.shipping_agent)}
            ${detailRow("الباخرة", s.vessel_name ? `${esc(s.vessel_name)}${s.voyage_no ? " / " + esc(s.voyage_no) : ""}` : null)}
            ${detailRow("رقم الرصيف", s.berth_no)}
            ${detailRow("بوليصة الشحن", s.bl_no)}
            ${detailRow("رقم الحاوية", s.container_no)}
            ${detailRow("الكمية", s.quantity ? `${s.quantity} ${esc(s.unit || "")}` : null)}
            ${detailRow("الوزن", s.weight_kg ? `${s.weight_kg} كغم` : null)}
            ${detailRow("قيمة البضاعة", s.goods_value ? money(s.goods_value, s.currency) : null)}
            ${detailRow("المسؤول (PIC)", s.assigned_name)}
            ${detailRow("ETD", fmtDate(s.etd))}
            ${detailRow("ETA", fmtDate(s.eta))}
            ${detailRow("وصول الباخرة (ATA)", fmtDate(s.vessel_ata))}
            ${detailRow("الوصول الفعلي", fmtDate(s.arrival_date))}
          </div>
          ${s.goods_description ? `<div class="detail-note"><strong>وصف البضاعة:</strong> ${esc(s.goods_description)}</div>` : ""}
          ${s.notes ? `<div class="detail-note"><strong>ملاحظات:</strong> ${esc(s.notes)}</div>` : ""}
        </div>
      </div>

      <div class="stack">
        ${customsCard(d, app)}
        <div class="card">
          <div class="card-head"><h2>📄 المستندات</h2>
            ${app.can("writeDocuments") ? `<span style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" id="add-doc-link">+ رابط</button>
              <button class="btn btn-sm btn-primary" id="add-doc">+ رفع ملف</button></span>` : ""}</div>
          <div class="card-body" id="docs-box">${renderDocs(d.documents, app)}</div>
        </div>
      </div>
    </div>

    ${renderCargo(s, app)}

    ${renderReexport(s, app)}

    ${renderMilestones(s, app)}

    <div class="grid-2">
      ${transportCard(d, app)}
      ${financeCard(d, app)}
    </div>

    <div class="card">
      <div class="card-head"><h2>📣 تحديثات الحالة</h2></div>
      <div class="card-body" id="updates-box">${spinner()}</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>التعليقات</h2></div>
        <div class="card-body" id="comments-box">${spinner()}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>المسار الزمني</h2></div>
        <div class="card-body" id="timeline-box">${spinner()}</div>
      </div>
    </div>
  `;

  // حذف الشحنة
  const delBtn = document.getElementById("del-ship");
  if (delBtn) delBtn.onclick = () => confirmDialog(`حذف الشحنة ${s.ref_no} نهائياً؟`, async () => {
    try { await API.deleteShipment(id); toast("تم الحذف", "success"); location.hash = "#/shipments"; }
    catch (e) { toast(e.message, "error"); }
  }, { danger: true });

  // تغيير الحالة
  root.querySelectorAll("[data-status]").forEach((b) => {
    b.onclick = async () => {
      try { await API.changeStatus(id, b.dataset.status); toast("تم تحديث الحالة", "success"); renderShipmentDetail(root, app, id); }
      catch (e) { toast(e.message, "error"); }
    };
  });

  // رفع مستند
  const addDoc = document.getElementById("add-doc");
  if (addDoc) addDoc.onclick = () => uploadDocModal(id, () => refreshDocs(id, app));
  const addDocLink = document.getElementById("add-doc-link");
  if (addDocLink) addDocLink.onclick = () => docLinkModal(id, () => refreshDocs(id, app));

  // حذف مستند (تفويض)
  document.getElementById("docs-box").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del-doc]");
    if (!btn) return;
    confirmDialog("حذف هذا المستند؟", async () => {
      try { await API.deleteDocument(btn.dataset.delDoc); toast("تم الحذف", "success"); refreshDocs(id, app); }
      catch (err) { toast(err.message, "error"); }
    }, { danger: true });
  });

  attachDownloads(document.getElementById("docs-box"));

  // ربط بطاقات الأقسام (كمارك/نقل/حسابات)
  const refresh = () => renderShipmentDetail(root, app, id);
  bindCustomsCard(d, app, refresh);
  bindTransportCard(d, app, refresh);
  bindFinanceCard(d, app, refresh);

  const editMs = document.getElementById("edit-milestones");
  if (editMs) editMs.onclick = () => milestonesForm(s, refresh);
  const editCargo = document.getElementById("edit-cargo");
  if (editCargo) editCargo.onclick = () => cargoForm(s, refresh);
  const addPen = document.getElementById("add-penalty");
  if (addPen) addPen.onclick = () => penaltyForm(null, refresh, s.ref_no);
  const editRx = document.getElementById("edit-reexport");
  if (editRx) editRx.onclick = () => reexportForm(s, refresh);

  loadUpdates(id, app);
  loadComments(id, app);
  loadTimeline(id);
}

// ---- المحطات الزمنية ----
function renderMilestones(s, app) {
  const canEdit = app.can("writeShipments") || app.can("writeCustoms") || app.can("writeTransport");
  const done = MILESTONES.filter((m) => s[m.key]);
  const steps = MILESTONES.map((m) => {
    const val = s[m.key];
    return `<div class="ms-step ${val ? "ms-done" : "ms-todo"}">
      <div class="ms-dot">${val ? "✓" : ""}</div>
      <div class="ms-info"><div class="ms-label">${esc(m.label)}</div><div class="ms-date">${val ? fmtDate(val) : "—"}</div></div>
    </div>`;
  }).join("");
  // حساب المدة الكلية إن توفّر أول وآخر تاريخ
  let durationNote = "";
  const dates = MILESTONES.map((m) => s[m.key]).filter(Boolean).map((d) => new Date(String(d).replace(" ", "T"))).filter((d) => !isNaN(d)).sort((a, b) => a - b);
  if (dates.length >= 2) {
    const days = Math.round((dates[dates.length - 1] - dates[0]) / 86400000);
    durationNote = `<span class="muted">المدة من أول محطة لآخرها: <strong>${days} يوم</strong> · أُنجز ${done.length}/${MILESTONES.length}</span>`;
  }
  return `<div class="card">
    <div class="card-head"><h2>🗓️ المحطات الزمنية</h2>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="edit-milestones">تحديث المحطات</button>` : ""}</div>
    <div class="card-body">
      <div class="ms-track">${steps}</div>
      ${durationNote ? `<div class="ms-foot">${durationNote}</div>` : ""}
    </div>
  </div>`;
}

function milestonesForm(s, refresh) {
  const labelOf = (k) => (MILESTONES.find((m) => m.key === k) || {}).label || k;
  const fields = MILESTONE_EDITABLE.map((k) =>
    k === "do2_no" ? field("رقم أمر التسليم الثاني", k, s[k] || "")
      : field(labelOf(k), k, s[k] || "", { type: "date" })
  ).join("");
  modal("تحديث المحطات الزمنية", `
    <form id="ms-form"><div class="form-grid">${fields}</div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" id="ms-cancel">إلغاء</button>
      </div>
    </form>`, { wide: true });
  document.getElementById("ms-cancel").onclick = closeModal;
  document.getElementById("ms-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { await API.updateMilestones(s.id, b); toast("تم حفظ المحطات", "success"); closeModal(); refresh(); }
    catch (err) { toast(err.message, "error"); }
  };
}

// ---- الحمولة (الحاويات + الودائع) ----
function renderCargo(s, app) {
  const canEdit = app.can("writeShipments") || app.can("writeTransport") || app.can("writeFinance");
  const n = (v) => Number(v) || 0;
  const conts = CONTAINER_TYPES.filter((c) => n(s[c.key]) > 0);
  const totalCont = conts.reduce((a, c) => a + n(s[c.key]), 0);
  const teu = CONTAINER_TYPES.reduce((a, c) => a + n(s[c.key]) * c.teu, 0);
  const contHtml = conts.length
    ? conts.map((c) => `<span class="cont-chip">${c.label}: <strong>${n(s[c.key])}</strong></span>`).join("")
    : '<span class="muted">لم تُحدّد الحاويات</span>';
  const cur = s.deposit_currency || "IQD";
  const balance = n(s.sl_deposit) - n(s.sl_deducted) - n(s.sl_returned);
  const hasDeposit = s.sl_deposit != null || s.sl_deducted != null || s.sl_returned != null;
  return `<div class="card">
    <div class="card-head"><h2>📦 الحمولة والحاويات</h2>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="edit-cargo">تحديث الحمولة</button>` : ""}</div>
    <div class="card-body">
      <div class="cont-row">${contHtml}</div>
      <div class="detail-grid" style="margin-top:12px">
        ${detailRow("إجمالي الحاويات", totalCont || null)}
        ${detailRow("المكافئ (TEU)", teu ? teu.toFixed(2) : null)}
        ${detailRow("الشاحنات المطلوبة", s.total_trailers)}
        ${detailRow("CBM", s.cbm)}
        ${detailRow("إجمالي الطرود", s.total_pkgs)}
        ${detailRow("نوع التغليف", s.packaging_type)}
      </div>
      ${hasDeposit ? `<h3 class="section-title" style="margin-top:16px">وديعة الخط الملاحي</h3>
        <div class="detail-grid">
          ${detailRow("الوديعة", s.sl_deposit != null ? money(s.sl_deposit, cur) : null)}
          ${detailRow("المخصوم", s.sl_deducted != null ? money(s.sl_deducted, cur) : null)}
          ${detailRow("المُعاد", s.sl_returned != null ? money(s.sl_returned, cur) : null)}
          ${detailRow("الرصيد المتبقّي", hasDeposit ? money(balance, cur) : null)}
          ${detailRow("تاريخ وصل الوديعة", fmtDate(s.deposit_receipt_date))}
        </div>` : ""}
      <div class="cargo-foot">
        ${app.can("writePenalties") ? `<button class="btn btn-sm btn-ghost" id="add-penalty">⚖️ تسجيل غرامة لهذه الشحنة</button>` : ""}
      </div>
    </div>
  </div>`;
}

function cargoForm(s, refresh) {
  const contFields = CONTAINER_TYPES.map((c) => field(c.label, c.key, s[c.key] != null ? s[c.key] : "", { type: "number" })).join("");
  modal("تحديث الحمولة والحاويات", `
    <form id="cargo-form">
      <h3 class="section-title">أعداد الحاويات</h3>
      <div class="form-grid">${contFields}</div>
      <h3 class="section-title">البضاعة</h3>
      <div class="form-grid">
        ${field("CBM", "cbm", s.cbm, { type: "number" })}
        ${field("إجمالي الطرود", "total_pkgs", s.total_pkgs, { type: "number" })}
        ${field("نوع التغليف", "packaging_type", s.packaging_type)}
        ${field("الشاحنات المطلوبة", "total_trailers", s.total_trailers, { type: "number" })}
      </div>
      <h3 class="section-title">وديعة الخط الملاحي</h3>
      <div class="form-grid">
        ${field("الوديعة", "sl_deposit", s.sl_deposit, { type: "number" })}
        ${field("المخصوم", "sl_deducted", s.sl_deducted, { type: "number" })}
        ${field("المُعاد", "sl_returned", s.sl_returned, { type: "number" })}
        ${field("العملة", "deposit_currency", s.deposit_currency || "IQD", { options: ["IQD", "USD", "EUR", "AED"] })}
        ${field("تاريخ وصل الوديعة", "deposit_receipt_date", s.deposit_receipt_date, { type: "date" })}
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" id="cargo-cancel">إلغاء</button></div>
    </form>`, { wide: true });
  document.getElementById("cargo-cancel").onclick = closeModal;
  document.getElementById("cargo-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { await API.updateCargo(s.id, b); toast("تم حفظ الحمولة", "success"); closeModal(); refresh(); }
    catch (err) { toast(err.message, "error"); }
  };
}

// ---- إعادة التصدير ----
function renderReexport(s, app) {
  if (s.importation_type !== "reexport") return "";
  const canEdit = app.can("writeShipments") || app.can("writeCustoms");
  return `<div class="card">
    <div class="card-head"><h2>♻️ إعادة التصدير</h2>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="edit-reexport">تحديث</button>` : ""}</div>
    <div class="card-body"><div class="detail-grid">
      ${detailRow("استلام Pre-alert", fmtDate(s.pre_alert_date))}
      ${detailRow("تقديم المستندات للجهة", fmtDate(s.docs_to_org_date))}
      ${detailRow("موافقة الإعفاء", s.exemption_approval)}
      ${detailRow("العبور (Transit)", s.transit_through)}
    </div></div></div>`;
}
function reexportForm(s, refresh) {
  modal("تحديث إعادة التصدير", `
    <form id="rx-form"><div class="form-grid">
      ${field("استلام Pre-alert", "pre_alert_date", s.pre_alert_date, { type: "date" })}
      ${field("تقديم المستندات للجهة", "docs_to_org_date", s.docs_to_org_date, { type: "date" })}
      ${field("موافقة الإعفاء", "exemption_approval", s.exemption_approval)}
      ${field("العبور (Transit/Through)", "transit_through", s.transit_through)}
    </div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" id="rx-cancel">إلغاء</button></div>
    </form>`);
  document.getElementById("rx-cancel").onclick = closeModal;
  document.getElementById("rx-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { await API.updateReexport(s.id, b); toast("تم الحفظ", "success"); closeModal(); refresh(); }
    catch (err) { toast(err.message, "error"); }
  };
}

// ---- تحديثات الحالة ----
async function loadUpdates(id, app) {
  const box = document.getElementById("updates-box");
  if (!box) return;
  let updates = [];
  try { updates = (await API.listUpdates(id)).updates; }
  catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); return; }
  const canPost = app.can("comment");
  box.innerHTML = `
    ${canPost ? `<form id="update-form" class="update-form">
      <input type="date" name="update_date" title="تاريخ التحديث">
      <textarea name="note" rows="2" placeholder="اكتب تحديث حالة الشحنة..." required></textarea>
      <button class="btn btn-primary btn-sm" type="submit">نشر</button>
    </form>` : ""}
    <div class="updates-list">
      ${updates.length ? updates.map((u) => `
        <div class="update-item">
          <div class="update-meta"><strong>${esc(u.user_name || "—")}</strong>
            <span class="muted">${u.update_date ? fmtDate(u.update_date) + " · " : ""}${timeAgo(u.created_at)}</span></div>
          <div class="update-note">${esc(u.note)}</div>
        </div>`).join("") : `<p class="muted">لا تحديثات بعد</p>`}
    </div>`;
  const f = document.getElementById("update-form");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    if (!b.note || !b.note.trim()) return;
    try { await API.addUpdate(id, b); renderShipmentDetail(document.getElementById("content"), app, id); }
    catch (err) { toast(err.message, "error"); }
  };
}

function detailRow(label, value) {
  return `<div class="dr"><span class="dr-l">${esc(label)}</span><span class="dr-v">${value ? esc(value) : "—"}</span></div>`;
}

function renderStatusFlow(s, app) {
  if (s.status === "cancelled") {
    return `<div class="status-flow cancelled"><span class="badge badge-red">الشحنة ملغاة</span>
      ${app.can("writeShipments") ? `<button class="btn btn-sm btn-ghost" data-status="opened">إعادة فتح</button>` : ""}</div>`;
  }
  const idx = STATUS_FLOW.indexOf(s.status);
  const steps = STATUS_FLOW.map((st, i) => {
    const cls = i < idx ? "done" : i === idx ? "current" : "todo";
    return `<div class="flow-step ${cls}"><div class="flow-dot">${i < idx ? "✓" : i + 1}</div><div class="flow-label">${STATUS_LABELS[st]}</div></div>`;
  }).join('<div class="flow-line"></div>');

  let actions = "";
  if (app.can("writeShipments") || app.can("writeCustoms") || app.can("writeTransport")) {
    const next = STATUS_FLOW[idx + 1];
    actions = `<div class="flow-actions">
      ${next ? `<button class="btn btn-sm btn-primary" data-status="${next}">التالي: ${STATUS_LABELS[next]} ←</button>` : ""}
      <button class="btn btn-sm btn-ghost" data-status="cancelled">إلغاء الشحنة</button>
    </div>`;
  }
  return `<div class="card status-flow-card"><div class="flow">${steps}</div>${actions}</div>`;
}

function renderDocs(docs, app) {
  if (!docs || !docs.length) return emptyState("لا مستندات بعد", "📄");
  return `<ul class="doc-list">
    ${docs.map((dc) => {
      const isLink = dc.kind === "link";
      const nameCell = isLink
        ? `<a href="${esc(dc.doc_url)}" target="_blank" rel="noopener" class="doc-name">🔗 ${esc(dc.title || dc.file_name)}</a>`
        : `<a href="#" class="doc-name" data-dl-doc="${dc.id}">${esc(dc.title || dc.file_name)}</a>`;
      return `<li>
        <span class="doc-type">${esc(DOC_TYPES[dc.doc_type] || dc.doc_type)}</span>
        ${nameCell}
        <span class="muted doc-meta">${esc(dc.uploaded_name || "")} · ${timeAgo(dc.uploaded_at)}</span>
        ${app.can("writeDocuments") ? `<button class="icon-btn" data-del-doc="${dc.id}" title="حذف">🗑️</button>` : ""}
      </li>`;
    }).join("")}
  </ul>`;
}

function docLinkModal(shipmentId, onDone) {
  modal("إضافة رابط مستند", `
    <form id="doclink-form">
      ${field("نوع المستند", "doc_type", "invoice", { options: Object.entries(DOC_TYPES).map(([v, l]) => ({ value: v, label: l })) })}
      ${field("العنوان", "title", "", { placeholder: "وصف مختصر للمستند" })}
      ${field("الرابط (URL)", "url", "", { required: true, placeholder: "https://drive.google.com/..." })}
      <p class="muted">مفيد لربط ملفات Google Drive دون رفعها — يعمل فوراً.</p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">إضافة</button>
        <button type="button" class="btn btn-ghost" id="doclink-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("doclink-cancel").onclick = closeModal;
  document.getElementById("doclink-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    try { await API.addDocumentLink(shipmentId, b); toast("تمت إضافة الرابط", "success"); closeModal(); onDone(); }
    catch (err) { toast(err.message, "error"); }
  };
}

async function refreshDocs(id, app) {
  const box = document.getElementById("docs-box");
  try { const d = await API.listDocuments(id); box.innerHTML = renderDocs(d.documents, app); attachDownloads(box); }
  catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); }
}

function attachDownloads(box) {
  box.querySelectorAll("[data-dl-doc]").forEach((a) => {
    a.onclick = async (e) => {
      e.preventDefault();
      try {
        const res = await API.downloadDocument(a.dataset.dlDoc);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = a.textContent.trim();
        document.body.appendChild(link); link.click(); link.remove();
        URL.revokeObjectURL(url);
      } catch (err) { toast("تعذّر التنزيل: " + err.message, "error"); }
    };
  });
}

function uploadDocModal(shipmentId, onDone) {
  modal("رفع مستند", `
    <form id="doc-form">
      ${field("نوع المستند", "doc_type", "invoice", { options: Object.entries(DOC_TYPES).map(([v, l]) => ({ value: v, label: l })) })}
      ${field("عنوان (اختياري)", "title", "")}
      <div class="field"><label>الملف <span class="req">*</span></label><input type="file" name="file" required></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">رفع</button>
        <button type="button" class="btn btn-ghost" id="doc-cancel">إلغاء</button>
      </div>
    </form>`);
  document.getElementById("doc-cancel").onclick = closeModal;
  document.getElementById("doc-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get("file") || !fd.get("file").name) { toast("اختر ملفاً", "error"); return; }
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "جارٍ الرفع...";
    try { await API.uploadDocument(shipmentId, fd); toast("تم رفع المستند", "success"); closeModal(); onDone(); }
    catch (err) { toast(err.message, "error"); btn.disabled = false; btn.textContent = "رفع"; }
  };
}

async function loadComments(id, app) {
  const box = document.getElementById("comments-box");
  let comments = [];
  try { comments = (await API.listComments(id)).comments; }
  catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); return; }
  const canComment = app.can("comment");
  box.innerHTML = `
    <div class="comments">
      ${comments.length ? comments.map((c) => `
        <div class="comment">
          <div class="comment-head"><strong>${esc(c.user_name || "—")}</strong><span class="muted">${timeAgo(c.created_at)}</span></div>
          <div class="comment-body">${esc(c.body)}</div>
        </div>`).join("") : `<p class="muted">لا تعليقات بعد</p>`}
    </div>
    ${canComment ? `
      <form id="comment-form" class="comment-form">
        <textarea name="body" rows="2" placeholder="اكتب تعليقاً..." required></textarea>
        <button class="btn btn-primary btn-sm" type="submit">إرسال</button>
      </form>` : ""}`;
  const cf = document.getElementById("comment-form");
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim();
    if (!body) return;
    try { await API.addComment(id, body); loadComments(id, app); }
    catch (err) { toast(err.message, "error"); }
  };
}

async function loadTimeline(id) {
  const box = document.getElementById("timeline-box");
  let tl = [];
  try { tl = (await API.timeline(id)).timeline; }
  catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); return; }
  if (!tl.length) { box.innerHTML = emptyState("لا أحداث", "🕒"); return; }
  const actionLabel = {
    create: "أنشأ الشحنة", update: "حدّث الشحنة", status_change: "غيّر الحالة",
    comment: "أضاف تعليقاً", upload: "رفع مستنداً", delete: "حذف",
  };
  box.innerHTML = `<ul class="timeline">
    ${tl.map((a) => `
      <li>
        <div class="tl-dot"></div>
        <div class="tl-body">
          <div><strong>${esc(a.user_name || "—")}</strong> ${esc(actionLabel[a.action] || a.action)}
            ${a.details ? `<span class="muted">(${esc(a.details)})</span>` : ""}</div>
          <div class="muted tl-time">${fmtDateTime(a.created_at)}</div>
        </div>
      </li>`).join("")}
  </ul>`;
}
