/** وحدة حالة المزامنة مع Google Sheets (للمدير) */
import { API } from "../api.js";
import { esc, fmtDateTime, timeAgo, spinner, emptyState, badge, ENTITY_LABELS, fieldLabel } from "../ui.js";

export async function renderSync(root, app) {
  if (!app.can("manageUsers")) { root.innerHTML = emptyState("لا تملك صلاحية", "🔒"); return; }
  root.innerHTML = `<div class="page-head"><h1>🔄 حالة المزامنة مع Google Sheets</h1>
    <div class="page-actions"><button class="btn btn-ghost" id="sync-refresh">↻ تحديث</button></div></div>
    <div id="sync-body">${spinner()}</div>`;
  document.getElementById("sync-refresh").onclick = () => load();

  const load = async () => {
    const box = document.getElementById("sync-body");
    box.innerHTML = spinner();
    let st, ch, ed;
    try { st = await API.syncStatus(); ch = await API.syncChanges("?limit=100"); }
    catch (e) { box.innerHTML = emptyState(e.message, "⚠️"); return; }
    try { ed = await API.syncEdits("?limit=80"); } catch { ed = { edits: [] }; }

    const t = st.today || {};
    const lastAgo = st.last ? timeAgo(st.last) : "—";
    const fresh = st.last && (Date.now() - new Date(st.last.replace(" ", "T") + "Z")) < 11 * 60000;
    const cards = [
      { label: "آخر مزامنة", value: lastAgo, icon: fresh ? "🟢" : "🟡", color: fresh ? "green" : "amber" },
      { label: "تغييرات اليوم", value: st.changes_today || 0, icon: "✏️", color: "blue" },
      { label: "أُضيف اليوم", value: t.ins || 0, icon: "➕", color: "green" },
      { label: "حُدّث اليوم", value: t.upd || 0, icon: "🔃", color: "violet" },
    ];

    box.innerHTML = `
      <div class="alert ${t.err > 0 ? "alert-danger" : "alert-info"}" style="margin-bottom:16px">
        ${t.err > 0 ? `⚠️ يوجد ${t.err} خطأ في مزامنة اليوم — راجع التفاصيل أدناه.` : "✅ المزامنة تعمل بسلاسة — لا أخطاء اليوم. أي إضافة في Google Sheets تظهر هنا خلال 5 دقائق."}
      </div>
      <div class="stats-grid">
        ${cards.map((c) => `<div class="stat-card stat-${c.color}"><div class="stat-icon">${c.icon}</div>
          <div class="stat-body"><div class="stat-value" style="font-size:19px">${esc(String(c.value))}</div><div class="stat-label">${c.label}</div></div></div>`).join("")}
      </div>

      <div class="card">
        <div class="card-head"><h2>👤 التعديلات المباشرة (حساب Google الفعلي)</h2></div>
        <div class="card-body">${renderEdits(ed.edits || [])}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>📝 من غيّر ماذا (المسؤول PIC + الحقول)</h2></div>
        <div class="card-body">${renderChanges(ch.changes || [])}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>سجل عمليات المزامنة الأخيرة</h2></div>
        <div class="card-body">${renderRuns(st.recent || [])}</div>
      </div>`;
  };

  function renderChanges(rows) {
    if (!rows.length) return emptyState("لا تغييرات مسجّلة بعد (ستظهر عند أي إضافة/تعديل في الشيت)", "📋");
    return `<div class="changes">
      ${rows.map((c) => {
        let fields = "";
        try {
          const obj = c.changed_fields ? JSON.parse(c.changed_fields) : null;
          if (obj) fields = Object.keys(obj).map((k) =>
            `<span class="chg"><b>${esc(fieldLabel(k))}:</b> <span class="chg-old">${esc(fmtVal(obj[k].old))}</span> ← <span class="chg-new">${esc(fmtVal(obj[k].new))}</span></span>`).join("");
        } catch {}
        const act = c.action === "insert" ? `<span class="badge badge-green">إضافة</span>` : `<span class="badge badge-blue">تعديل</span>`;
        const link = c.entity_type === "shipment" ? `<a class="link" href="#/shipments/${c.entity_id}">${esc(c.ref_no || "—")}</a>` : esc(c.ref_no || "—");
        return `<div class="chg-row">
          <div class="chg-head">
            ${act}
            <span class="chg-who">👤 ${esc(c.pic || "غير محدد")}</span>
            <span class="chg-ent">${esc(ENTITY_LABELS[c.entity_type] || c.entity_type)} ${link}</span>
            <span class="muted chg-time">${timeAgo(c.created_at)}</span>
          </div>
          ${fields ? `<div class="chg-fields">${fields}</div>` : (c.action === "insert" ? `<div class="chg-fields muted">سجل جديد من «${esc(c.source || "")}»</div>` : "")}
        </div>`;
      }).join("")}
    </div>`;
  }
  function fmtVal(v) { if (v == null || v === "") return "—"; return String(v); }

  function renderEdits(rows) {
    if (!rows.length) return emptyState("لا تعديلات مباشرة بعد (تظهر فور تعديل أي موظف لخلية في Google Sheets)", "👤");
    return `<table class="table compact"><thead><tr><th>المُعدِّل (Google)</th><th>الملف/التبويب</th><th>الشحنة</th><th>العمود</th><th>قديم ← جديد</th><th>الوقت</th></tr></thead><tbody>
      ${rows.map((e) => `<tr>
        <td><strong>${esc(e.editor || "غير معروف")}</strong></td>
        <td>${esc(e.tab || "—")}</td>
        <td>${esc(e.ref_no || "—")}</td>
        <td>${esc(e.column_header || "—")}</td>
        <td><span class="chg-old">${esc(e.old_value || "—")}</span> ← <span class="chg-new">${esc(e.new_value || "—")}</span></td>
        <td class="muted">${timeAgo(e.created_at)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  function renderRuns(rows) {
    if (!rows.length) return emptyState("لا عمليات", "🕒");
    return `<table class="table compact"><thead><tr><th>المصدر</th><th>أُضيف</th><th>حُدّث</th><th>تخطّي</th><th>أخطاء</th><th>الوقت</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td>${esc(r.source || "—")}</td><td>${r.inserted}</td><td>${r.updated}</td><td>${r.skipped}</td>
        <td>${r.errors > 0 ? `<span class="badge badge-red">${r.errors}</span>` : "0"}</td>
        <td class="muted">${fmtDateTime(r.created_at)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  load();
}
