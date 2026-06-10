/**
 * =====================================================================
 *  MASAR — Cloudflare Worker (API)
 *  نظام إدارة العمليات والشحنات | شركة عبر الشرق النفطية
 *  المؤلف: م. مهند المظفر — قسم التكنولوجيا
 *
 *  بنية: D1 (قاعدة بيانات) + R2 (مستندات) + JWT (جلسات) + PBKDF2 (كلمات المرور)
 *  ملف واحد، يُنشر كما هو عبر: wrangler deploy
 * =====================================================================
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

// أدوار النظام
const ROLES = ["admin", "manager", "logistics", "customs", "transport", "accounting", "viewer"];

// مراحل دورة حياة الشحنة (الترتيب مهم لمنطق الانتقال)
const SHIPMENT_STATUSES = [
  "draft", "opened", "at_port", "customs_clearance",
  "in_transport", "delivered", "closed", "cancelled",
];

// =====================================================================
//  أدوات مساعدة عامة
// =====================================================================
// أصول مسموح بها فقط (الرابط الإنتاجي + معاينات pages.dev + التطوير المحلي)
const ALLOWED_ORIGINS = [
  "https://masar-bhw.pages.dev",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.masar-bhw\.pages\.dev$/;

function cors(origin) {
  // الافتراضي: الرابط الإنتاجي. الأصول غير المعروفة لن تتطابق فيمنعها المتصفح.
  let allow = "https://masar-bhw.pages.dev";
  if (origin && (ALLOWED_ORIGINS.includes(origin) || PAGES_PREVIEW_RE.test(origin))) {
    allow = origin;
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function err(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function ok(data = {}) {
  return json({ ok: true, ...data });
}

// =====================================================================
//  تشفير: base64url / PBKDF2 / JWT (HMAC-SHA256)
// =====================================================================
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- PBKDF2 لكلمات المرور ----
async function hashPassword(password, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial, 256
  );
  return `pbkdf2:${iterations}:${b64urlEncode(salt)}:${b64urlEncode(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split(":");
    if (scheme !== "pbkdf2") return false;
    const iterations = parseInt(iterStr, 10);
    const salt = b64urlDecode(saltB64);
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial, 256
    );
    const calc = b64urlEncode(new Uint8Array(bits));
    // مقارنة بزمن ثابت
    if (calc.length !== hashB64.length) return false;
    let diff = 0;
    for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hashB64.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// ---- JWT ----
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

async function signJWT(payload, secret, ttlSeconds = 60 * 60 * 12) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(body)));
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC", key, b64urlDecode(s), enc.encode(`${h}.${p}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(p)));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// =====================================================================
//  أدوات قاعدة البيانات والمساعدات
// =====================================================================
async function logActivity(env, { userId, action, entityType, entityId, details, ip }) {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(userId || null, action, entityType || null, entityId || null,
      details ? (typeof details === "string" ? details : JSON.stringify(details)) : null,
      ip || null).run();
  } catch (e) { /* لا نُفشل العملية بسبب فشل التسجيل */ }
}

async function notify(env, userId, title, body, link) {
  if (!userId) return;
  try {
    await env.DB.prepare(
      `INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)`
    ).bind(userId, title, body || null, link || null).run();
  } catch (e) { /* تجاهل */ }
}

// ---- حدّ المحاولات (مكافحة brute-force) ----
const RL_WINDOW_MIN = 15;   // نافذة العدّ بالدقائق
const RL_LOCK_MIN = 15;     // مدة القفل بالدقائق

async function isLocked(env, key) {
  try {
    const row = await env.DB.prepare(`SELECT locked_until FROM rate_limits WHERE rl_key=?`).bind(key).first();
    if (!row || !row.locked_until) return false;
    return new Date(row.locked_until.replace(" ", "T") + "Z").getTime() > Date.now();
  } catch { return false; }
}

async function registerFailure(env, key, maxAttempts) {
  try {
    const row = await env.DB.prepare(`SELECT count, window_start FROM rate_limits WHERE rl_key=?`).bind(key).first();
    if (!row) {
      await env.DB.prepare(`INSERT INTO rate_limits (rl_key, count, window_start) VALUES (?, 1, datetime('now'))`).bind(key).run();
      return;
    }
    const windowStart = new Date(row.window_start.replace(" ", "T") + "Z").getTime();
    if (Date.now() - windowStart > RL_WINDOW_MIN * 60000) {
      // انتهت النافذة → إعادة العدّ
      await env.DB.prepare(`UPDATE rate_limits SET count=1, window_start=datetime('now'), locked_until=NULL WHERE rl_key=?`).bind(key).run();
      return;
    }
    const newCount = (row.count || 0) + 1;
    if (newCount >= maxAttempts) {
      await env.DB.prepare(`UPDATE rate_limits SET count=?, locked_until=datetime('now', ?) WHERE rl_key=?`).bind(newCount, `+${RL_LOCK_MIN} minutes`, key).run();
    } else {
      await env.DB.prepare(`UPDATE rate_limits SET count=? WHERE rl_key=?`).bind(newCount, key).run();
    }
  } catch { /* لا نُفشل الطلب بسبب فشل العدّ */ }
}

async function clearLimit(env, key) {
  try { await env.DB.prepare(`DELETE FROM rate_limits WHERE rl_key=?`).bind(key).run(); } catch {}
}

async function nextShipmentRef(env) {
  const year = new Date().getFullYear();
  const counterName = `shipment_${year}`;
  await env.DB.prepare(
    `INSERT INTO counters (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`
  ).bind(counterName).run();
  const row = await env.DB.prepare(`SELECT value FROM counters WHERE name = ?`).bind(counterName).first();
  const seq = String(row.value).padStart(4, "0");
  return `MSR-${year}-${seq}`;
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// تحويل آمن للقيم المنطقية (يتعامل مع "0"/"1"/"true"/"false")
function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

// =====================================================================
//  الصلاحيات (RBAC)
// =====================================================================
const PERM = {
  manageUsers:    ["admin", "manager"],
  writeShipments: ["admin", "manager", "logistics"],
  deleteShipments:["admin", "manager"],
  writeSuppliers: ["admin", "manager", "logistics"],
  writeClients: ["admin", "manager", "logistics"],
  writeDocuments: ["admin", "manager", "logistics", "customs", "transport"],
  writeCustoms:   ["admin", "manager", "customs"],
  writeCustomsOps:["admin", "manager", "customs"],
  writeTransport: ["admin", "manager", "transport"],
  writeFinance:   ["admin", "manager", "accounting"],
  writeCarriers:  ["admin", "manager", "transport", "logistics"],
  writePenalties: ["admin", "manager", "accounting", "logistics", "customs"],
  viewReports:    ["admin", "manager", "accounting"],
  comment:        ["admin", "manager", "logistics", "customs", "transport", "accounting"],
};

function can(user, perm) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return (PERM[perm] || []).includes(user.role);
}

// =====================================================================
//  المصادقة: استخراج المستخدم من التوكن
// =====================================================================
async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = env.JWT_SECRET;
  if (!secret) return null;
  const payload = await verifyJWT(m[1], secret);
  if (!payload || !payload.sub) return null;
  const user = await env.DB.prepare(
    `SELECT * FROM users WHERE id = ? AND active = 1`
  ).bind(payload.sub).first();
  return user || null;
}

// =====================================================================
//  مُوجِّه الطلبات (Router)
// =====================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let response;
    try {
      response = await route(request, env, url);
    } catch (e) {
      response = err("خطأ داخلي في الخادم: " + (e?.message || e), 500);
    }

    // إضافة ترويسات CORS + الأمان لكل استجابة
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return new Response(response.body, { status: response.status, headers });
  },

  // مُشغّل مجدوَل (Cron) — تنبيهات واتساب للمخاطر الحرجة
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertNotifications(env));
  },
};

// =====================================================================
//  تنبيهات واتساب للمخاطر الحرجة (مجدوَلة)
// =====================================================================
async function runAlertNotifications(env){
  try {
    const recipients = String(env.WA_RECIPIENTS || "").split(",").map(s=>s.trim()).filter(Boolean);
    if (!recipients.length) return; // لم تُضبط الأرقام بعد
    const lines = [];

    // 1) أرضيات: تجاوزت أيام السماح
    const dem = (await env.DB.prepare(
      `SELECT s.ref_no, cl.name AS client_name, c.port_arrival_date, c.free_days
       FROM shipments s LEFT JOIN clients cl ON cl.id=s.client_id
       LEFT JOIN customs_declarations c ON c.id=(SELECT id FROM customs_declarations WHERE shipment_id=s.id ORDER BY id DESC LIMIT 1)
       WHERE s.status IN ('at_port','customs_clearance') AND c.port_arrival_date IS NOT NULL`
    ).all()).results;
    const demOver = [];
    for (const r of dem){ const arr=new Date(String(r.port_arrival_date).replace(" ","T")); if(isNaN(arr))continue;
      const days=Math.floor((Date.now()-arr)/86400000); const rem=(r.free_days||0)-days;
      if(rem<=2) demOver.push(`• ${r.ref_no} (${r.client_name||"-"}): ${rem<0?("تجاوز "+Math.abs(rem)+" يوم"):("متبقّي "+rem+" يوم")}`); }
    if(demOver.length) lines.push("⏱️ *خطر الأرضيات (Demurrage):*\n"+demOver.slice(0,15).join("\n"));

    // 2) انتهاء CD/LB خلال 7 أيام أو منتهٍ
    const ops=(await env.DB.prepare(
      `SELECT abr_ref, cd_no, cd_new_expire, lb_no, lb_new_expire FROM customs_operations
       WHERE status!='done' AND (cd_new_expire IS NOT NULL OR lb_new_expire IS NOT NULL)`).all()).results;
    const cdlb=[];
    for(const o of ops){ for(const [kind,no,exp] of [["CD",o.cd_no,o.cd_new_expire],["LB",o.lb_no,o.lb_new_expire]]){
      if(!exp)continue; const d=new Date(String(exp).replace(" ","T")); if(isNaN(d))continue;
      const left=Math.ceil((d-Date.now())/86400000);
      if(left<=7) cdlb.push(`• ${kind} ${no||""} (${o.abr_ref||"-"}): ${left<0?("منتهٍ منذ "+Math.abs(left)+" يوم"):("خلال "+left+" يوم")}`); } }
    if(cdlb.length) lines.push("📜 *انتهاء مستندات/كفالات الكمارك:*\n"+cdlb.slice(0,15).join("\n"));

    // 3) شحنات متأخرة: تجاوزت ETA بأكثر من 3 أيام ولم تُسلَّم
    const overdue=(await env.DB.prepare(
      `SELECT s.ref_no, cl.name AS client_name, s.eta FROM shipments s LEFT JOIN clients cl ON cl.id=s.client_id
       WHERE s.eta IS NOT NULL AND s.eta < date('now','-3 days') AND s.status NOT IN ('delivered','closed','cancelled')
       ORDER BY s.eta ASC LIMIT 15`).all()).results;
    if(overdue.length) lines.push("⚠️ *شحنات متأخرة (تجاوزت ETA):*\n"+overdue.map(r=>`• ${r.ref_no} (${r.client_name||"-"}): ETA ${r.eta}`).join("\n"));

    if(!lines.length) return; // لا مخاطر — لا رسالة
    const msg = "🛢️ *MASAR — تنبيهات شركة عبر الشرق*\n"+new Date().toLocaleDateString("ar")+"\n\n"+lines.join("\n\n")+"\n\n🔗 https://masar-bhw.pages.dev";
    for(const to of recipients){ await sendWhatsApp(env, to, msg); }
    try{ await env.DB.prepare(`INSERT INTO sync_log (source, inserted, updated, skipped, errors, detail) VALUES ('WA-ALERT',0,0,0,0,?)`).bind(`أُرسل تنبيه لـ ${recipients.length} رقم (${lines.length} فئة)`).run(); }catch(_){}
  } catch(e){ /* صامت */ }
}

// إرسال واتساب — يدعم UltraMsg أو Meta Cloud API حسب الأسرار المضبوطة
async function sendWhatsApp(env, to, body){
  try{
    if(env.WA_INSTANCE && env.WA_TOKEN){ // UltraMsg
      await fetch(`https://api.ultramsg.com/${env.WA_INSTANCE}/messages/chat`, {
        method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({ token:env.WA_TOKEN, to, body }) });
    } else if(env.WA_META_PHONE_ID && env.WA_META_TOKEN){ // Meta WhatsApp Cloud API
      await fetch(`https://graph.facebook.com/v20.0/${env.WA_META_PHONE_ID}/messages`, {
        method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+env.WA_META_TOKEN},
        body:JSON.stringify({ messaging_product:"whatsapp", to, type:"text", text:{ body } }) });
    }
  }catch(_){}
}

async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  const ip = request.headers.get("CF-Connecting-IP") || "";

  // ---------- الصحة ----------
  if (path === "/api/health") {
    let db = "unknown";
    try { await env.DB.prepare("SELECT 1").first(); db = "ok"; } catch { db = "error"; }
    return ok({ service: "MASAR API", version: "1.0.0", db, time: new Date().toISOString() });
  }

  // ---------- الإعداد الأولي: إنشاء أول مدير ----------
  if (path === "/api/setup" && method === "POST") {
    return handleSetup(request, env);
  }

  // ---------- تسجيل الدخول ----------
  if (path === "/api/auth/login" && method === "POST") {
    return handleLogin(request, env, ip);
  }

  // ---------- مزامنة Google Sheets (محمية برمز SYNC_TOKEN) ----------
  if (path === "/api/sync/ingest" && method === "POST") {
    return ingestSync(request, env);
  }
  if (path === "/api/sync/edit" && method === "POST") {
    return ingestEdit(request, env);
  }

  // كل ما بعده يتطلب مصادقة
  const user = await authenticate(request, env);
  if (!user) return err("غير مصرّح — سجّل الدخول", 401);

  // فرض تغيير كلمة المرور المؤقتة قبل أي عملية أخرى
  if (user.must_change && !(path === "/api/auth/me" || path === "/api/auth/change-password")) {
    return err("يجب تغيير كلمة المرور قبل المتابعة", 403, { must_change: true });
  }

  // ---------- معلومات المستخدم الحالي ----------
  if (path === "/api/auth/me" && method === "GET") {
    return ok({ user: sanitizeUser(user) });
  }
  if (path === "/api/auth/change-password" && method === "POST") {
    return handleChangePassword(request, env, user);
  }

  // ---------- المستخدمون ----------
  if (path === "/api/users") {
    if (method === "GET") return listUsers(env, user);
    if (method === "POST") return createUser(request, env, user, ip);
  }
  let m;
  if ((m = path.match(/^\/api\/users\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PUT") return updateUser(request, env, user, id, ip);
    if (method === "DELETE") return deactivateUser(env, user, id, ip);
  }
  if ((m = path.match(/^\/api\/users\/(\d+)\/reset-password$/)) && method === "POST") {
    return resetUserPassword(request, env, user, +m[1], ip);
  }

  // ---------- الموردون ----------
  if (path === "/api/suppliers") {
    if (method === "GET") return listSuppliers(env);
    if (method === "POST") return createSupplier(request, env, user, ip);
  }
  if ((m = path.match(/^\/api\/suppliers\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PUT") return updateSupplier(request, env, user, id, ip);
    if (method === "DELETE") return deleteSupplier(env, user, id, ip);
  }

  // ---------- العملاء ----------
  if (path === "/api/clients") {
    if (method === "GET") return listClients(env);
    if (method === "POST") return createClient(request, env, user, ip);
  }
  if ((m = path.match(/^\/api\/clients\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PUT") return updateClient(request, env, user, id, ip);
    if (method === "DELETE") return deleteClient(env, user, id, ip);
  }

  // ---------- الشحنات ----------
  if (path === "/api/shipments") {
    if (method === "GET") return listShipments(request, env, url);
    if (method === "POST") return createShipment(request, env, user, ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") return getShipment(env, id);
    if (method === "PUT") return updateShipment(request, env, user, id, ip);
    if (method === "DELETE") return deleteShipment(env, user, id, ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/status$/)) && method === "POST") {
    return changeShipmentStatus(request, env, user, +m[1], ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/timeline$/)) && method === "GET") {
    return shipmentTimeline(env, +m[1]);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/milestones$/)) && method === "PUT") {
    return updateMilestones(request, env, user, +m[1], ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/cargo$/)) && method === "PUT") {
    return updateCargo(request, env, user, +m[1], ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/reexport$/)) && method === "PUT") {
    return updateReexport(request, env, user, +m[1], ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/penalties$/)) && method === "GET") {
    return listShipmentPenalties(env, +m[1]);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/updates$/))) {
    const id = +m[1];
    if (method === "GET") return listStatusUpdates(env, id);
    if (method === "POST") return addStatusUpdate(request, env, user, id, ip);
  }
  if (path === "/api/alerts" && method === "GET") return alerts(env, user);
  if (path === "/api/alerts/send-now" && method === "POST") {
    if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
    const recipients = String(env.WA_RECIPIENTS || "").split(",").map(s=>s.trim()).filter(Boolean);
    const provider = (env.WA_INSTANCE && env.WA_TOKEN) ? "UltraMsg" : ((env.WA_META_PHONE_ID && env.WA_META_TOKEN) ? "Meta" : null);
    if (!recipients.length) return err("لم تُضبط أرقام المستلمين (WA_RECIPIENTS) بعد", 400);
    if (!provider) return err("لم يُضبط مزوّد واتساب (أسرار UltraMsg أو Meta) بعد", 400);
    await runAlertNotifications(env);
    return ok({ message: `تم تشغيل الإرسال عبر ${provider} لـ ${recipients.length} رقم`, provider, recipients: recipients.length });
  }

  // ---------- المستندات ----------
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/documents$/))) {
    const id = +m[1];
    if (method === "GET") return listDocuments(env, id);
    if (method === "POST") return uploadDocument(request, env, user, id, ip);
  }
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/document-link$/)) && method === "POST") {
    return addDocumentLink(request, env, user, +m[1], ip);
  }
  if ((m = path.match(/^\/api\/documents\/(\d+)\/download$/)) && method === "GET") {
    return downloadDocument(env, +m[1]);
  }
  if ((m = path.match(/^\/api\/documents\/(\d+)$/)) && method === "DELETE") {
    return deleteDocument(env, user, +m[1], ip);
  }

  // ---------- التعليقات ----------
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/comments$/))) {
    const id = +m[1];
    if (method === "GET") return listComments(env, id);
    if (method === "POST") return addComment(request, env, user, id, ip);
  }

  // ---------- التخليص الكمركي ----------
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/customs$/)) && method === "POST") {
    return saveCustoms(request, env, user, +m[1], ip);
  }
  if (path === "/api/customs/queue" && method === "GET") return customsQueue(env, user);

  // ---------- عمليات الكمارك (CD/LB) ----------
  if (path === "/api/customs-ops") {
    if (method === "GET") return listCustomsOps(env, user);
    if (method === "POST") return createCustomsOp(request, env, user, ip);
  }
  if ((m = path.match(/^\/api\/customs-ops\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") return getCustomsOp(env, id);
    if (method === "PUT") return updateCustomsOp(request, env, user, id, ip);
    if (method === "DELETE") return deleteCustomsOp(env, user, id, ip);
  }

  // ---------- النقل ----------
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/transport$/))) {
    const id = +m[1];
    if (method === "GET") return listTransport(env, id);
    if (method === "POST") return createTransport(request, env, user, id, ip);
  }
  if ((m = path.match(/^\/api\/transport\/(\d+)$/))) {
    const tid = +m[1];
    if (method === "PUT") return updateTransport(request, env, user, tid, ip);
    if (method === "DELETE") return deleteTransport(env, user, tid, ip);
  }
  if (path === "/api/transport/queue" && method === "GET") return transportQueue(env, user);

  // ---------- الحسابات ----------
  if ((m = path.match(/^\/api\/shipments\/(\d+)\/finance$/))) {
    const id = +m[1];
    if (method === "GET") return listFinance(env, id);
    if (method === "POST") return createFinance(request, env, user, id, ip);
  }
  if ((m = path.match(/^\/api\/finance\/(\d+)$/))) {
    const fid = +m[1];
    if (method === "PUT") return updateFinance(request, env, user, fid, ip);
    if (method === "DELETE") return deleteFinance(env, user, fid, ip);
  }
  if (path === "/api/finance/overview" && method === "GET") return financeOverview(request, env, user, url);

  // ---------- الناقلون ----------
  if (path === "/api/carriers") {
    if (method === "GET") return listCarriers(env);
    if (method === "POST") return createCarrier(request, env, user, ip);
  }
  if ((m = path.match(/^\/api\/carriers\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PUT") return updateCarrier(request, env, user, id, ip);
    if (method === "DELETE") return deleteCarrier(env, user, id, ip);
  }

  // ---------- الغرامات ----------
  if (path === "/api/penalties") {
    if (method === "GET") return listPenalties(env, user);
    if (method === "POST") return createPenalty(request, env, user, ip);
  }
  if ((m = path.match(/^\/api\/penalties\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PUT") return updatePenalty(request, env, user, id, ip);
    if (method === "DELETE") return deletePenalty(env, user, id, ip);
  }

  // ---------- الإشعارات ----------
  if (path === "/api/notifications" && method === "GET") return listNotifications(env, user);
  if (path === "/api/notifications/read-all" && method === "POST") return readAllNotifications(env, user);
  if ((m = path.match(/^\/api\/notifications\/(\d+)\/read$/)) && method === "POST") {
    return readNotification(env, user, +m[1]);
  }

  // ---------- لوحة المعلومات ----------
  if (path === "/api/dashboard" && method === "GET") return dashboard(env, user);

  // ---------- التقارير ----------
  if (path === "/api/reports" && method === "GET") return reports(env, user);

  // ---------- جودة البيانات ----------
  if (path === "/api/quality" && method === "GET") return dataQuality(env, user);

  // ---------- حالة المزامنة وسجل التغييرات ----------
  if (path === "/api/sync/status" && method === "GET") return syncStatus(env, user);
  if (path === "/api/sync/changes" && method === "GET") return syncChanges(request, env, user, url);
  if (path === "/api/sync/edits" && method === "GET") return syncEdits(request, env, user, url);

  // ---------- سجل النشاط ----------
  if (path === "/api/activity" && method === "GET") return listActivity(request, env, user, url);

  return err("المسار غير موجود", 404);
}

// =====================================================================
//  المعالجات: المصادقة والإعداد
// =====================================================================
async function handleSetup(request, env) {
  const body = await request.json().catch(() => ({}));
  const { token, full_name, username, password } = body;
  if (!env.SETUP_TOKEN) return err("SETUP_TOKEN غير مضبوط على الخادم", 500);
  if ((token || "").trim() !== env.SETUP_TOKEN.trim()) return err("توكن الإعداد غير صحيح", 403);

  const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users`).first();
  if (count.c > 0) return err("الإعداد تمّ مسبقاً — يوجد مستخدمون", 409);
  if (!full_name || !username || !password || password.length < 8) {
    return err("الاسم واسم المستخدم وكلمة مرور (8 أحرف فأكثر) مطلوبة", 400);
  }

  const hash = await hashPassword(password);
  const res = await env.DB.prepare(
    `INSERT INTO users (full_name, username, password_hash, role, department, active)
     VALUES (?, ?, ?, 'admin', 'الإدارة', 1)`
  ).bind(full_name, username, hash).run();
  await env.DB.prepare(`UPDATE settings SET value='1' WHERE key='setup_done'`).run();
  await logActivity(env, { userId: res.meta.last_row_id, action: "setup", entityType: "user", entityId: res.meta.last_row_id });
  return ok({ message: "تم إنشاء المدير الأول", user_id: res.meta.last_row_id });
}

async function handleLogin(request, env, ip) {
  if (!env.JWT_SECRET) return err("JWT_SECRET غير مضبوط على الخادم", 500);
  const { username, password } = await request.json().catch(() => ({}));
  if (!username || !password) return err("اسم المستخدم وكلمة المرور مطلوبان", 400);

  // حدّ المحاولات: قفل بعد 5 محاولات فاشلة للمستخدم أو 15 لعنوان IP خلال 15 دقيقة
  const ipKey = `login:ip:${ip || "unknown"}`;
  const userKey = `login:user:${String(username).toLowerCase()}`;
  if (await isLocked(env, userKey) || await isLocked(env, ipKey)) {
    await logActivity(env, { userId: null, action: "login_locked", entityType: "user", details: username, ip });
    return err("تم تجاوز عدد محاولات الدخول المسموح. الرجاء المحاولة بعد 15 دقيقة.", 429);
  }

  const user = await env.DB.prepare(
    `SELECT * FROM users WHERE username = ? AND active = 1`
  ).bind(username).first();

  // التحقق دائماً (لتفادي تسريب وجود المستخدم عبر التوقيت)
  const valid = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, "pbkdf2:1:x:y");
  if (!user || !valid) {
    await registerFailure(env, userKey, 5);
    await registerFailure(env, ipKey, 15);
    await logActivity(env, { userId: user?.id, action: "login_failed", entityType: "user", details: username, ip });
    return err("بيانات الدخول غير صحيحة", 401);
  }

  // نجاح → تصفير عدّادات المحاولات
  await clearLimit(env, userKey);
  await clearLimit(env, ipKey);
  await env.DB.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).bind(user.id).run();
  const token = await signJWT({ sub: user.id, role: user.role, name: user.full_name }, env.JWT_SECRET);
  await logActivity(env, { userId: user.id, action: "login", entityType: "user", entityId: user.id, ip });
  return ok({ token, user: sanitizeUser(user) });
}

async function handleChangePassword(request, env, user) {
  const { old_password, new_password } = await request.json().catch(() => ({}));
  if (!new_password || new_password.length < 8) return err("كلمة المرور الجديدة 8 أحرف فأكثر", 400);
  const valid = await verifyPassword(old_password || "", user.password_hash);
  if (!valid) return err("كلمة المرور الحالية غير صحيحة", 403);
  const hash = await hashPassword(new_password);
  await env.DB.prepare(`UPDATE users SET password_hash=?, must_change=0, updated_at=datetime('now') WHERE id=?`)
    .bind(hash, user.id).run();
  await logActivity(env, { userId: user.id, action: "change_password", entityType: "user", entityId: user.id });
  return ok({ message: "تم تغيير كلمة المرور" });
}

// =====================================================================
//  المستخدمون
// =====================================================================
async function listUsers(env, user) {
  if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
  const { results } = await env.DB.prepare(
    `SELECT id, full_name, username, email, phone, role, department, active, last_login, created_at
     FROM users ORDER BY id DESC`
  ).all();
  return ok({ users: results });
}

async function createUser(request, env, user, ip) {
  if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  if (!b.full_name || !b.username || !b.password || b.password.length < 8) {
    return err("الاسم واسم المستخدم وكلمة مرور (8 أحرف فأكثر) مطلوبة", 400);
  }
  if (!ROLES.includes(b.role)) return err("الدور غير صحيح", 400);
  const exists = await env.DB.prepare(`SELECT id FROM users WHERE username=?`).bind(b.username).first();
  if (exists) return err("اسم المستخدم مستخدم مسبقاً", 409);
  const hash = await hashPassword(b.password);
  try {
    const res = await env.DB.prepare(
      `INSERT INTO users (full_name, username, email, phone, password_hash, role, department, must_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).bind(b.full_name, b.username, b.email || null, b.phone || null, hash, b.role, b.department || null, user.id).run();
    await logActivity(env, { userId: user.id, action: "create", entityType: "user", entityId: res.meta.last_row_id, details: b.username, ip });
    return ok({ id: res.meta.last_row_id, message: "تم إنشاء المستخدم" });
  } catch (e) {
    return err("تعذّر إنشاء المستخدم: " + e.message, 400);
  }
}

async function updateUser(request, env, user, id, ip) {
  if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  const target = await env.DB.prepare(`SELECT * FROM users WHERE id=?`).bind(id).first();
  if (!target) return err("المستخدم غير موجود", 404);
  if (b.role && !ROLES.includes(b.role)) return err("الدور غير صحيح", 400);
  await env.DB.prepare(
    `UPDATE users SET full_name=?, email=?, phone=?, role=?, department=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    b.full_name ?? target.full_name,
    b.email ?? target.email,
    b.phone ?? target.phone,
    b.role ?? target.role,
    b.department ?? target.department,
    b.active != null ? (b.active ? 1 : 0) : target.active,
    id
  ).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "user", entityId: id, ip });
  return ok({ message: "تم تحديث المستخدم" });
}

async function deactivateUser(env, user, id, ip) {
  if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
  if (id === user.id) return err("لا يمكنك تعطيل حسابك", 400);
  await env.DB.prepare(`UPDATE users SET active=0, updated_at=datetime('now') WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "deactivate", entityType: "user", entityId: id, ip });
  return ok({ message: "تم تعطيل المستخدم" });
}

async function resetUserPassword(request, env, user, id, ip) {
  if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
  const { new_password } = await request.json().catch(() => ({}));
  if (!new_password || new_password.length < 8) return err("كلمة المرور 8 أحرف فأكثر", 400);
  const hash = await hashPassword(new_password);
  await env.DB.prepare(`UPDATE users SET password_hash=?, must_change=1, updated_at=datetime('now') WHERE id=?`)
    .bind(hash, id).run();
  await logActivity(env, { userId: user.id, action: "reset_password", entityType: "user", entityId: id, ip });
  return ok({ message: "تم تعيين كلمة مرور جديدة" });
}

// =====================================================================
//  الموردون
// =====================================================================
async function listSuppliers(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM suppliers ORDER BY name COLLATE NOCASE`
  ).all();
  return ok({ suppliers: results });
}

async function createSupplier(request, env, user, ip) {
  if (!can(user, "writeSuppliers")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  if (!b.name) return err("اسم المورد مطلوب", 400);
  const res = await env.DB.prepare(
    `INSERT INTO suppliers (name, country, contact, email, phone, address, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(b.name, b.country || null, b.contact || null, b.email || null, b.phone || null, b.address || null, b.notes || null, user.id).run();
  await logActivity(env, { userId: user.id, action: "create", entityType: "supplier", entityId: res.meta.last_row_id, details: b.name, ip });
  return ok({ id: res.meta.last_row_id, message: "تم إضافة المورد" });
}

async function updateSupplier(request, env, user, id, ip) {
  if (!can(user, "writeSuppliers")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  const t = await env.DB.prepare(`SELECT * FROM suppliers WHERE id=?`).bind(id).first();
  if (!t) return err("المورد غير موجود", 404);
  await env.DB.prepare(
    `UPDATE suppliers SET name=?, country=?, contact=?, email=?, phone=?, address=?, notes=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    b.name ?? t.name, b.country ?? t.country, b.contact ?? t.contact, b.email ?? t.email,
    b.phone ?? t.phone, b.address ?? t.address, b.notes ?? t.notes,
    b.active != null ? (b.active ? 1 : 0) : t.active, id
  ).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "supplier", entityId: id, ip });
  return ok({ message: "تم تحديث المورد" });
}

async function deleteSupplier(env, user, id, ip) {
  if (!can(user, "writeSuppliers")) return err("لا تملك صلاحية", 403);
  // حذف ناعم
  await env.DB.prepare(`UPDATE suppliers SET active=0, updated_at=datetime('now') WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "supplier", entityId: id, ip });
  return ok({ message: "تم حذف المورد" });
}

// =====================================================================
//  العملاء (شركات النفط المخدومة)
// =====================================================================
async function listClients(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM clients ORDER BY name COLLATE NOCASE`).all();
  return ok({ clients: results });
}

async function createClient(request, env, user, ip) {
  if (!can(user, "writeClients")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  if (!b.name) return err("اسم العميل مطلوب", 400);
  const res = await env.DB.prepare(
    `INSERT INTO clients (name, code, contact, email, phone, address, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(b.name, b.code || null, b.contact || null, b.email || null, b.phone || null, b.address || null, b.notes || null, user.id).run();
  await logActivity(env, { userId: user.id, action: "create", entityType: "client", entityId: res.meta.last_row_id, details: b.name, ip });
  return ok({ id: res.meta.last_row_id, message: "تم إضافة العميل" });
}

async function updateClient(request, env, user, id, ip) {
  if (!can(user, "writeClients")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  const t = await env.DB.prepare(`SELECT * FROM clients WHERE id=?`).bind(id).first();
  if (!t) return err("العميل غير موجود", 404);
  await env.DB.prepare(
    `UPDATE clients SET name=?, code=?, contact=?, email=?, phone=?, address=?, notes=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    b.name ?? t.name, b.code ?? t.code, b.contact ?? t.contact, b.email ?? t.email,
    b.phone ?? t.phone, b.address ?? t.address, b.notes ?? t.notes,
    b.active != null ? (b.active ? 1 : 0) : t.active, id
  ).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "client", entityId: id, ip });
  return ok({ message: "تم تحديث العميل" });
}

async function deleteClient(env, user, id, ip) {
  if (!can(user, "writeClients")) return err("لا تملك صلاحية", 403);
  await env.DB.prepare(`UPDATE clients SET active=0, updated_at=datetime('now') WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "client", entityId: id, ip });
  return ok({ message: "تم حذف العميل" });
}

// =====================================================================
//  الشحنات
// =====================================================================
async function listShipments(request, env, url) {
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  const supplierId = url.searchParams.get("supplier_id");
  const clientId = url.searchParams.get("client_id");
  const assigned = url.searchParams.get("assigned_to");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "25", 10));
  const offset = (page - 1) * limit;

  const where = [];
  const args = [];
  if (status && SHIPMENT_STATUSES.includes(status)) { where.push("s.status = ?"); args.push(status); }
  if (supplierId) { where.push("s.supplier_id = ?"); args.push(+supplierId); }
  if (clientId) { where.push("s.client_id = ?"); args.push(+clientId); }
  if (assigned) { where.push("s.assigned_to = ?"); args.push(+assigned); }
  if (q) {
    where.push("(s.ref_no LIKE ? OR s.title LIKE ? OR s.bl_no LIKE ? OR s.container_no LIKE ? OR s.goods_description LIKE ? OR s.call_off LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM shipments s ${whereSql}`).bind(...args).first();
  const { results } = await env.DB.prepare(
    `SELECT s.*, sup.name AS supplier_name, cl.name AS client_name, u.full_name AS assigned_name
     FROM shipments s
     LEFT JOIN suppliers sup ON sup.id = s.supplier_id
     LEFT JOIN clients cl ON cl.id = s.client_id
     LEFT JOIN users u ON u.id = s.assigned_to
     ${whereSql}
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();

  return ok({ shipments: results, total: countRow.c, page, limit });
}

async function getShipment(env, id) {
  const s = await env.DB.prepare(
    `SELECT s.*, sup.name AS supplier_name, sup.country AS supplier_country,
            cl.name AS client_name, cl.code AS client_code,
            u.full_name AS assigned_name, c.full_name AS created_name
     FROM shipments s
     LEFT JOIN suppliers sup ON sup.id = s.supplier_id
     LEFT JOIN clients cl ON cl.id = s.client_id
     LEFT JOIN users u ON u.id = s.assigned_to
     LEFT JOIN users c ON c.id = s.created_by
     WHERE s.id = ?`
  ).bind(id).first();
  if (!s) return err("الشحنة غير موجودة", 404);

  const docs = (await env.DB.prepare(
    `SELECT d.*, u.full_name AS uploaded_name FROM shipment_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.shipment_id=? ORDER BY d.uploaded_at DESC`
  ).bind(id).all()).results;

  const customs = await env.DB.prepare(`SELECT * FROM customs_declarations WHERE shipment_id=? ORDER BY id DESC LIMIT 1`).bind(id).first();
  const transport = (await env.DB.prepare(`SELECT * FROM transport_orders WHERE shipment_id=? ORDER BY id DESC`).bind(id).all()).results;
  const finance = (await env.DB.prepare(`SELECT * FROM finance_records WHERE shipment_id=? ORDER BY id DESC`).bind(id).all()).results;

  const financeSummary = finance.reduce((acc, r) => {
    if (r.type === "cost") acc.total_cost += r.amount || 0;
    if (r.type === "payment") acc.total_paid += r.amount || 0;
    return acc;
  }, { total_cost: 0, total_paid: 0 });

  return ok({ shipment: s, documents: docs, customs, transport, finance, finance_summary: financeSummary });
}

async function createShipment(request, env, user, ip) {
  if (!can(user, "writeShipments")) return err("لا تملك صلاحية إنشاء شحنة", 403);
  const b = await request.json().catch(() => ({}));
  if (!b.title) return err("عنوان الشحنة مطلوب", 400);
  const status = SHIPMENT_STATUSES.includes(b.status) ? b.status : "opened";
  const refNo = await nextShipmentRef(env);
  const res = await env.DB.prepare(
    `INSERT INTO shipments
       (ref_no, title, client_id, supplier_id, call_off, call_off_date, importation_type,
        status, priority, transport_mode, incoterm, shipping_line, shipping_agent,
        vessel_name, voyage_no, vessel_ata, berth_no,
        origin_country, origin_port, destination, goods_description, quantity, unit,
        weight_kg, container_no, bl_no, currency, goods_value, etd, eta,
        assigned_to, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    refNo, b.title, b.client_id || null, b.supplier_id || null, b.call_off || null,
    b.call_off_date || null, b.importation_type || null, status, b.priority || "normal",
    b.transport_mode || null, b.incoterm || null, b.shipping_line || null, b.shipping_agent || null,
    b.vessel_name || null, b.voyage_no || null, b.vessel_ata || null, b.berth_no || null,
    b.origin_country || null, b.origin_port || null, b.destination || null, b.goods_description || null,
    b.quantity || null, b.unit || null, b.weight_kg || null, b.container_no || null,
    b.bl_no || null, b.currency || "USD", b.goods_value || null, b.etd || null,
    b.eta || null, b.assigned_to || null, user.id
  ).run();
  const id = res.meta.last_row_id;
  await logActivity(env, { userId: user.id, action: "create", entityType: "shipment", entityId: id, details: refNo, ip });
  if (b.assigned_to && b.assigned_to !== user.id) {
    await notify(env, b.assigned_to, "تم إسناد شحنة إليك", `${refNo} — ${b.title}`, `#/shipments/${id}`);
  }
  return ok({ id, ref_no: refNo, message: "تم إنشاء الشحنة" });
}

async function updateShipment(request, env, user, id, ip) {
  if (!can(user, "writeShipments")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  const t = await env.DB.prepare(`SELECT * FROM shipments WHERE id=?`).bind(id).first();
  if (!t) return err("الشحنة غير موجودة", 404);
  await env.DB.prepare(
    `UPDATE shipments SET title=?, client_id=?, supplier_id=?, call_off=?, call_off_date=?, importation_type=?,
       priority=?, transport_mode=?, incoterm=?, shipping_line=?, shipping_agent=?,
       vessel_name=?, voyage_no=?, vessel_ata=?, berth_no=?,
       origin_country=?, origin_port=?, destination=?, goods_description=?, quantity=?, unit=?,
       weight_kg=?, container_no=?, bl_no=?, currency=?, goods_value=?, etd=?, eta=?,
       arrival_date=?, assigned_to=?, notes=?, updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    b.title ?? t.title, b.client_id ?? t.client_id, b.supplier_id ?? t.supplier_id,
    b.call_off ?? t.call_off, b.call_off_date ?? t.call_off_date, b.importation_type ?? t.importation_type,
    b.priority ?? t.priority, b.transport_mode ?? t.transport_mode, b.incoterm ?? t.incoterm,
    b.shipping_line ?? t.shipping_line, b.shipping_agent ?? t.shipping_agent,
    b.vessel_name ?? t.vessel_name, b.voyage_no ?? t.voyage_no, b.vessel_ata ?? t.vessel_ata, b.berth_no ?? t.berth_no,
    b.origin_country ?? t.origin_country, b.origin_port ?? t.origin_port,
    b.destination ?? t.destination, b.goods_description ?? t.goods_description,
    b.quantity ?? t.quantity, b.unit ?? t.unit, b.weight_kg ?? t.weight_kg,
    b.container_no ?? t.container_no, b.bl_no ?? t.bl_no, b.currency ?? t.currency,
    b.goods_value ?? t.goods_value, b.etd ?? t.etd, b.eta ?? t.eta,
    b.arrival_date ?? t.arrival_date, b.assigned_to ?? t.assigned_to, b.notes ?? t.notes, id
  ).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "shipment", entityId: id, details: t.ref_no, ip });
  return ok({ message: "تم تحديث الشحنة" });
}

async function changeShipmentStatus(request, env, user, id, ip) {
  if (!can(user, "writeShipments") && !can(user, "writeCustoms") && !can(user, "writeTransport")) {
    return err("لا تملك صلاحية", 403);
  }
  const { status } = await request.json().catch(() => ({}));
  if (!SHIPMENT_STATUSES.includes(status)) return err("حالة غير صحيحة", 400);
  const t = await env.DB.prepare(`SELECT * FROM shipments WHERE id=?`).bind(id).first();
  if (!t) return err("الشحنة غير موجودة", 404);

  const stamps = {};
  if (status === "at_port" && !t.arrival_date) stamps.arrival_date = "datetime('now')";
  let extra = "";
  if (status === "delivered") extra = ", delivered_date=datetime('now')";
  if (status === "closed") extra = ", closed_date=datetime('now')";

  await env.DB.prepare(`UPDATE shipments SET status=?${extra}, updated_at=datetime('now') WHERE id=?`).bind(status, id).run();
  await logActivity(env, { userId: user.id, action: "status_change", entityType: "shipment", entityId: id, details: `${t.status} → ${status}`, ip });
  if (t.assigned_to && t.assigned_to !== user.id) {
    await notify(env, t.assigned_to, "تغيّرت حالة شحنة", `${t.ref_no}: ${status}`, `#/shipments/${id}`);
  }
  return ok({ message: "تم تحديث الحالة" });
}

async function deleteShipment(env, user, id, ip) {
  if (!can(user, "deleteShipments")) return err("لا تملك صلاحية الحذف", 403);
  const t = await env.DB.prepare(`SELECT ref_no FROM shipments WHERE id=?`).bind(id).first();
  if (!t) return err("الشحنة غير موجودة", 404);
  await env.DB.prepare(`DELETE FROM shipments WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "shipment", entityId: id, details: t.ref_no, ip });
  return ok({ message: "تم حذف الشحنة" });
}

async function shipmentTimeline(env, id) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.full_name AS user_name FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity_type='shipment' AND a.entity_id=?
     ORDER BY a.created_at DESC LIMIT 200`
  ).bind(id).all();
  return ok({ timeline: results });
}

// المحطات الزمنية (تحديث مخصّص لقائمة بيضاء من الأعمدة)
const MILESTONE_FIELDS = [
  "docs_submission_date", "do1_date", "do2_date", "do2_no", "trailer_booking_date",
  "trailer_entry_date", "loading_date", "releasing_date", "arrival_site_date",
  "offloading_pod_date", "return_token_date", "cc_receipt_date",
  "finance_settlement_date", "handover_account_date", "accounting_invoice_date",
];

async function updateMilestones(request, env, user, id, ip) {
  if (!can(user, "writeShipments") && !can(user, "writeCustoms") && !can(user, "writeTransport")) {
    return err("لا تملك صلاحية", 403);
  }
  const t = await env.DB.prepare(`SELECT ref_no FROM shipments WHERE id=?`).bind(id).first();
  if (!t) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const sets = [], args = [];
  for (const f of MILESTONE_FIELDS) {
    if (f in b) { sets.push(`${f}=?`); args.push(b[f] === "" ? null : b[f]); }
  }
  if (!sets.length) return err("لا حقول للتحديث", 400);
  args.push(id);
  await env.DB.prepare(`UPDATE shipments SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).bind(...args).run();
  await logActivity(env, { userId: user.id, action: "milestones", entityType: "shipment", entityId: id, details: t.ref_no, ip });
  return ok({ message: "تم حفظ المحطات الزمنية" });
}

// الحمولة (الحاويات/CBM/الطرود/الشاحنات) + ودائع الخط الملاحي
const CARGO_FIELDS = [
  "cont_20std", "cont_20fr", "cont_20ot", "cont_40std", "cont_40fr", "cont_40ot",
  "cont_45", "lcl", "roro", "cbm", "total_pkgs", "packaging_type", "total_trailers",
  "sl_deposit", "sl_deducted", "sl_returned", "deposit_currency", "deposit_receipt_date",
];
const CARGO_NUMERIC = new Set(["cont_20std","cont_20fr","cont_20ot","cont_40std","cont_40fr","cont_40ot","cont_45","lcl","roro","cbm","total_pkgs","total_trailers","sl_deposit","sl_deducted","sl_returned"]);

async function updateCargo(request, env, user, id, ip) {
  if (!can(user, "writeShipments") && !can(user, "writeTransport") && !can(user, "writeFinance")) {
    return err("لا تملك صلاحية", 403);
  }
  const t = await env.DB.prepare(`SELECT ref_no FROM shipments WHERE id=?`).bind(id).first();
  if (!t) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const sets = [], args = [];
  for (const f of CARGO_FIELDS) {
    if (f in b) {
      let v = b[f] === "" ? null : b[f];
      if (v != null && CARGO_NUMERIC.has(f)) v = num(v);
      sets.push(`${f}=?`); args.push(v);
    }
  }
  if (!sets.length) return err("لا حقول للتحديث", 400);
  args.push(id);
  await env.DB.prepare(`UPDATE shipments SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).bind(...args).run();
  await logActivity(env, { userId: user.id, action: "cargo", entityType: "shipment", entityId: id, details: t.ref_no, ip });
  return ok({ message: "تم حفظ بيانات الحمولة" });
}

// حقول إعادة التصدير
const REEXPORT_FIELDS = ["pre_alert_date", "docs_to_org_date", "exemption_approval", "transit_through"];
async function updateReexport(request, env, user, id, ip) {
  if (!can(user, "writeShipments") && !can(user, "writeCustoms")) return err("لا تملك صلاحية", 403);
  const t = await env.DB.prepare(`SELECT ref_no FROM shipments WHERE id=?`).bind(id).first();
  if (!t) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const sets = [], args = [];
  for (const f of REEXPORT_FIELDS) { if (f in b) { sets.push(`${f}=?`); args.push(b[f] === "" ? null : b[f]); } }
  if (!sets.length) return err("لا حقول للتحديث", 400);
  args.push(id);
  await env.DB.prepare(`UPDATE shipments SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).bind(...args).run();
  await logActivity(env, { userId: user.id, action: "reexport", entityType: "shipment", entityId: id, details: t.ref_no, ip });
  return ok({ message: "تم حفظ بيانات إعادة التصدير" });
}

// =====================================================================
//  عمليات الكمارك (CD/LB)
// =====================================================================
async function listCustomsOps(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT co.*, cl.name AS client_name FROM customs_operations co
     LEFT JOIN clients cl ON cl.id=co.client_id ORDER BY co.id DESC LIMIT 500`
  ).all();
  return ok({ operations: results });
}
async function getCustomsOp(env, id) {
  const op = await env.DB.prepare(
    `SELECT co.*, cl.name AS client_name FROM customs_operations co
     LEFT JOIN clients cl ON cl.id=co.client_id WHERE co.id=?`
  ).bind(id).first();
  if (!op) return err("العملية غير موجودة", 404);
  return ok({ operation: op });
}
const CUSTOPS_FIELDS = ["abr_ref","job_type","client_id","pic","operation_org","oil_company","contract_no","qty_cdlb","cd_no","cd_last_expire","cd_new_expire","lb_no","lb_last_expire","lb_new_expire","process_start_date","process_end_date","handover_account_date","receive_account_date","invoice_client_date","status","notes"];
const CUSTOPS_BOOL = ["handover_to_client","pod_signed"];
async function createCustomsOp(request, env, user, ip) {
  if (!can(user, "writeCustomsOps")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  const cols = [], ph = [], args = [];
  for (const f of CUSTOPS_FIELDS) { cols.push(f); ph.push("?"); let v = b[f] === "" ? null : (b[f] ?? null); if (f === "client_id" && v != null) v = num(v); args.push(v); }
  for (const f of CUSTOPS_BOOL) { cols.push(f); ph.push("?"); args.push(truthy(b[f]) ? 1 : 0); }
  cols.push("created_by"); ph.push("?"); args.push(user.id);
  const res = await env.DB.prepare(`INSERT INTO customs_operations (${cols.join(",")}) VALUES (${ph.join(",")})`).bind(...args).run();
  await logActivity(env, { userId: user.id, action: "create", entityType: "customs_op", entityId: res.meta.last_row_id, details: b.abr_ref || "", ip });
  return ok({ id: res.meta.last_row_id, message: "تم إنشاء عملية الكمارك" });
}
async function updateCustomsOp(request, env, user, id, ip) {
  if (!can(user, "writeCustomsOps")) return err("لا تملك صلاحية", 403);
  const t = await env.DB.prepare(`SELECT id FROM customs_operations WHERE id=?`).bind(id).first();
  if (!t) return err("العملية غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const sets = [], args = [];
  for (const f of CUSTOPS_FIELDS) { if (f in b) { let v = b[f] === "" ? null : b[f]; if (f === "client_id" && v != null) v = num(v); sets.push(`${f}=?`); args.push(v); } }
  for (const f of CUSTOPS_BOOL) { if (f in b) { sets.push(`${f}=?`); args.push(truthy(b[f]) ? 1 : 0); } }
  if (!sets.length) return err("لا حقول للتحديث", 400);
  args.push(id);
  await env.DB.prepare(`UPDATE customs_operations SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?`).bind(...args).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "customs_op", entityId: id, ip });
  return ok({ message: "تم تحديث العملية" });
}
async function deleteCustomsOp(env, user, id, ip) {
  if (!can(user, "writeCustomsOps")) return err("لا تملك صلاحية", 403);
  await env.DB.prepare(`DELETE FROM customs_operations WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "customs_op", entityId: id, ip });
  return ok({ message: "تم حذف العملية" });
}

// تحديثات الحالة (السرد المؤرّخ)
async function listStatusUpdates(env, id) {
  const { results } = await env.DB.prepare(
    `SELECT su.*, u.full_name AS user_name FROM status_updates su
     LEFT JOIN users u ON u.id=su.created_by WHERE su.shipment_id=? ORDER BY su.id DESC LIMIT 100`
  ).bind(id).all();
  return ok({ updates: results });
}

async function addStatusUpdate(request, env, user, id, ip) {
  if (!can(user, "comment")) return err("لا تملك صلاحية", 403);
  const ship = await env.DB.prepare(`SELECT ref_no, assigned_to FROM shipments WHERE id=?`).bind(id).first();
  if (!ship) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const note = (b.note || "").trim();
  if (!note) return err("نص التحديث مطلوب", 400);
  const upDate = b.update_date || null;
  await env.DB.prepare(
    `INSERT INTO status_updates (shipment_id, note, update_date, created_by) VALUES (?,?,?,?)`
  ).bind(id, note, upDate, user.id).run();
  // حدّث آخر تحديث على الشحنة (يظهر في القوائم واللوحة)
  await env.DB.prepare(
    `UPDATE shipments SET latest_update=?, latest_update_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
  ).bind(note.slice(0, 300), id).run();
  if (ship.assigned_to && ship.assigned_to !== user.id) {
    await notify(env, ship.assigned_to, "تحديث على شحنة", `${ship.ref_no}: ${note.slice(0, 80)}`, `#/shipments/${id}`);
  }
  await logActivity(env, { userId: user.id, action: "update_note", entityType: "shipment", entityId: id, ip });
  return ok({ message: "تم إضافة التحديث" });
}

// التنبيهات الذكية (لوجستية)
async function alerts(env, user) {
  // 1) خطر الأرضيات (Demurrage): شحنات في الميناء/التخليص تجاوزت أو تقترب من أيام السماح
  const demRows = (await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, cl.name AS client_name,
            c.port_arrival_date, c.free_days
     FROM shipments s
     LEFT JOIN clients cl ON cl.id=s.client_id
     LEFT JOIN customs_declarations c ON c.id=(SELECT id FROM customs_declarations WHERE shipment_id=s.id ORDER BY id DESC LIMIT 1)
     WHERE s.status IN ('at_port','customs_clearance') AND c.port_arrival_date IS NOT NULL`
  ).all()).results;
  const demurrage = [];
  for (const r of demRows) {
    const arr = new Date(String(r.port_arrival_date).replace(" ", "T"));
    if (isNaN(arr)) continue;
    const days = Math.floor((Date.now() - arr) / 86400000);
    const remaining = (r.free_days || 0) - days;
    if (remaining <= 3) {
      demurrage.push({ ...r, days_at_port: days, remaining_free: remaining,
        over: remaining < 0 ? Math.abs(remaining) : 0 });
    }
  }
  demurrage.sort((a, b) => a.remaining_free - b.remaining_free);

  // 2) متأخرة: تجاوزت ETA ولم تُسلّم
  const overdue = (await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, s.eta, cl.name AS client_name
     FROM shipments s LEFT JOIN clients cl ON cl.id=s.client_id
     WHERE s.eta IS NOT NULL AND s.eta < date('now')
       AND s.status NOT IN ('delivered','closed','cancelled')
     ORDER BY s.eta ASC LIMIT 50`
  ).all()).results;

  // 3) راكدة: لم تُحدّث منذ 7 أيام وغير منتهية
  const stale = (await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, s.updated_at, cl.name AS client_name
     FROM shipments s LEFT JOIN clients cl ON cl.id=s.client_id
     WHERE s.updated_at < datetime('now','-7 days')
       AND s.status NOT IN ('delivered','closed','cancelled')
     ORDER BY s.updated_at ASC LIMIT 50`
  ).all()).results;

  // 4) انتهاء CD/LB: مستندات كمركية أو كفالات تنتهي خلال 30 يوماً أو منتهية
  const cdlbRows = (await env.DB.prepare(
    `SELECT co.id, co.abr_ref, co.job_type, co.cd_no, co.cd_new_expire, co.lb_no, co.lb_new_expire,
            cl.name AS client_name
     FROM customs_operations co LEFT JOIN clients cl ON cl.id=co.client_id
     WHERE co.status != 'done' AND (co.cd_new_expire IS NOT NULL OR co.lb_new_expire IS NOT NULL)`
  ).all()).results;
  const cdlb = [];
  for (const r of cdlbRows) {
    const items = [];
    for (const [kind, no, exp] of [["CD", r.cd_no, r.cd_new_expire], ["LB", r.lb_no, r.lb_new_expire]]) {
      if (!exp) continue;
      const d = new Date(String(exp).replace(" ", "T"));
      if (isNaN(d)) continue;
      const daysLeft = Math.ceil((d - Date.now()) / 86400000);
      if (daysLeft <= 30) items.push({ kind, no, expire: exp, days_left: daysLeft });
    }
    if (items.length) cdlb.push({ id: r.id, abr_ref: r.abr_ref, client_name: r.client_name, items });
  }
  cdlb.sort((a, b) => Math.min(...a.items.map((i) => i.days_left)) - Math.min(...b.items.map((i) => i.days_left)));

  return ok({ demurrage, overdue, stale, cdlb,
    counts: { demurrage: demurrage.length, overdue: overdue.length, stale: stale.length, cdlb: cdlb.length } });
}

// =====================================================================
//  المستندات (R2)
// =====================================================================
async function listDocuments(env, shipmentId) {
  const { results } = await env.DB.prepare(
    `SELECT d.*, u.full_name AS uploaded_name FROM shipment_documents d
     LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.shipment_id=? ORDER BY d.uploaded_at DESC`
  ).bind(shipmentId).all();
  return ok({ documents: results });
}

async function uploadDocument(request, env, user, shipmentId, ip) {
  if (!can(user, "writeDocuments")) return err("لا تملك صلاحية رفع المستندات", 403);
  if (!env.DOCS) return err("خدمة تخزين المستندات (R2) غير مُفعّلة بعد", 503);
  const ship = await env.DB.prepare(`SELECT id, ref_no FROM shipments WHERE id=?`).bind(shipmentId).first();
  if (!ship) return err("الشحنة غير موجودة", 404);

  const form = await request.formData().catch(() => null);
  if (!form) return err("صيغة الرفع غير صحيحة (FormData مطلوب)", 400);
  const file = form.get("file");
  if (!file || typeof file === "string") return err("الملف مطلوب", 400);
  const docType = form.get("doc_type") || "other";
  const title = form.get("title") || file.name;

  const MAX = 20 * 1024 * 1024; // 20MB
  if (file.size > MAX) return err("حجم الملف يتجاوز 20 ميغابايت", 413);

  const safeName = (file.name || "file").replace(/[^\w.\-]+/g, "_");
  const key = `shipments/${shipmentId}/${Date.now()}_${safeName}`;
  await env.DOCS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  const res = await env.DB.prepare(
    `INSERT INTO shipment_documents (shipment_id, doc_type, title, file_name, r2_key, size_bytes, mime_type, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(shipmentId, docType, title, file.name || safeName, key, file.size, file.type || null, user.id).run();
  await logActivity(env, { userId: user.id, action: "upload", entityType: "document", entityId: res.meta.last_row_id, details: `${ship.ref_no}: ${title}`, ip });
  return ok({ id: res.meta.last_row_id, message: "تم رفع المستند" });
}

async function addDocumentLink(request, env, user, shipmentId, ip) {
  if (!can(user, "writeDocuments")) return err("لا تملك صلاحية إضافة المستندات", 403);
  const ship = await env.DB.prepare(`SELECT id, ref_no FROM shipments WHERE id=?`).bind(shipmentId).first();
  if (!ship) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const url = (b.url || "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return err("رابط غير صحيح (يجب أن يبدأ بـ http/https)", 400);
  const title = (b.title || "").trim() || url;
  const docType = b.doc_type || "other";
  const res = await env.DB.prepare(
    `INSERT INTO shipment_documents (shipment_id, kind, doc_type, title, file_name, r2_key, doc_url, uploaded_by)
     VALUES (?, 'link', ?, ?, ?, '', ?, ?)`
  ).bind(shipmentId, docType, title, title, url, user.id).run();
  await logActivity(env, { userId: user.id, action: "doc_link", entityType: "document", entityId: res.meta.last_row_id, details: `${ship.ref_no}: ${title}`, ip });
  return ok({ id: res.meta.last_row_id, message: "تمت إضافة رابط المستند" });
}

async function downloadDocument(env, docId) {
  const doc = await env.DB.prepare(`SELECT * FROM shipment_documents WHERE id=?`).bind(docId).first();
  if (!doc) return err("المستند غير موجود", 404);
  if (doc.kind === "link") return Response.redirect(doc.doc_url, 302);
  if (!env.DOCS) return err("خدمة تخزين المستندات (R2) غير مُفعّلة بعد", 503);
  const obj = await env.DOCS.get(doc.r2_key);
  if (!obj) return err("الملف غير موجود في التخزين", 404);
  const headers = new Headers();
  headers.set("Content-Type", doc.mime_type || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
  return new Response(obj.body, { status: 200, headers });
}

async function deleteDocument(env, user, docId, ip) {
  if (!can(user, "writeDocuments")) return err("لا تملك صلاحية", 403);
  const doc = await env.DB.prepare(`SELECT * FROM shipment_documents WHERE id=?`).bind(docId).first();
  if (!doc) return err("المستند غير موجود", 404);
  if (doc.kind === "file" && doc.r2_key && env.DOCS) {
    await env.DOCS.delete(doc.r2_key).catch(() => {});
  }
  await env.DB.prepare(`DELETE FROM shipment_documents WHERE id=?`).bind(docId).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "document", entityId: docId, ip });
  return ok({ message: "تم حذف المستند" });
}

// =====================================================================
//  التعليقات
// =====================================================================
async function listComments(env, shipmentId) {
  const { results } = await env.DB.prepare(
    `SELECT c.*, u.full_name AS user_name, u.role AS user_role FROM comments c
     LEFT JOIN users u ON u.id=c.user_id WHERE c.shipment_id=? ORDER BY c.created_at ASC`
  ).bind(shipmentId).all();
  return ok({ comments: results });
}

async function addComment(request, env, user, shipmentId, ip) {
  if (!can(user, "comment")) return err("لا تملك صلاحية التعليق", 403);
  const { body } = await request.json().catch(() => ({}));
  if (!body || !body.trim()) return err("نص التعليق مطلوب", 400);
  const ship = await env.DB.prepare(`SELECT id, ref_no, assigned_to FROM shipments WHERE id=?`).bind(shipmentId).first();
  if (!ship) return err("الشحنة غير موجودة", 404);
  const res = await env.DB.prepare(
    `INSERT INTO comments (shipment_id, user_id, body) VALUES (?,?,?)`
  ).bind(shipmentId, user.id, body.trim()).run();
  if (ship.assigned_to && ship.assigned_to !== user.id) {
    await notify(env, ship.assigned_to, "تعليق جديد على شحنة", `${ship.ref_no}`, `#/shipments/${shipmentId}`);
  }
  await logActivity(env, { userId: user.id, action: "comment", entityType: "shipment", entityId: shipmentId, ip });
  return ok({ id: res.meta.last_row_id, message: "تمت إضافة التعليق" });
}

// =====================================================================
//  التخليص الكمركي
// =====================================================================
function calcDemurrage(portArrival, freeDays) {
  if (!portArrival) return { days_at_port: 0, demurrage_days: 0 };
  const arr = new Date(portArrival.replace(" ", "T"));
  if (isNaN(arr)) return { days_at_port: 0, demurrage_days: 0 };
  const days = Math.floor((Date.now() - arr) / 86400000);
  const dem = Math.max(0, days - (freeDays || 0));
  return { days_at_port: Math.max(0, days), demurrage_days: dem };
}

async function saveCustoms(request, env, user, shipmentId, ip) {
  if (!can(user, "writeCustoms")) return err("لا تملك صلاحية التخليص الكمركي", 403);
  const ship = await env.DB.prepare(`SELECT id, ref_no, status, assigned_to FROM shipments WHERE id=?`).bind(shipmentId).first();
  if (!ship) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));

  const duty = num(b.duty_amount), tax = num(b.tax_amount), other = num(b.other_fees);
  const total = b.total_fees != null && b.total_fees !== "" ? num(b.total_fees) : (duty + tax + other);

  const existing = await env.DB.prepare(`SELECT id FROM customs_declarations WHERE shipment_id=? ORDER BY id DESC LIMIT 1`).bind(shipmentId).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE customs_declarations SET declaration_no=?, customs_office=?, hs_code=?, duty_rate=?,
         duty_amount=?, tax_amount=?, other_fees=?, total_fees=?, currency=?, clearance_status=?,
         port_arrival_date=?, free_days=?, cleared_date=?, broker_name=?, notes=?, updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      b.declaration_no || null, b.customs_office || null, b.hs_code || null, num(b.duty_rate),
      duty, tax, other, total, b.currency || "USD", b.clearance_status || "pending",
      b.port_arrival_date || null, parseInt(b.free_days || 0, 10), b.cleared_date || null,
      b.broker_name || null, b.notes || null, existing.id
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO customs_declarations
        (shipment_id, declaration_no, customs_office, hs_code, duty_rate, duty_amount, tax_amount,
         other_fees, total_fees, currency, clearance_status, port_arrival_date, free_days, cleared_date,
         broker_name, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      shipmentId, b.declaration_no || null, b.customs_office || null, b.hs_code || null, num(b.duty_rate),
      duty, tax, other, total, b.currency || "USD", b.clearance_status || "pending",
      b.port_arrival_date || null, parseInt(b.free_days || 0, 10), b.cleared_date || null,
      b.broker_name || null, b.notes || null, user.id
    ).run();
  }

  // تحديث حالة الشحنة تلقائياً حسب التخليص
  if (b.clearance_status === "cleared" && ship.status === "customs_clearance") {
    await env.DB.prepare(`UPDATE shipments SET status='in_transport', updated_at=datetime('now') WHERE id=?`).bind(shipmentId).run();
  } else if (b.clearance_status && b.clearance_status !== "pending" && ["opened","at_port"].includes(ship.status)) {
    await env.DB.prepare(`UPDATE shipments SET status='customs_clearance', updated_at=datetime('now') WHERE id=?`).bind(shipmentId).run();
  }

  await logActivity(env, { userId: user.id, action: "customs", entityType: "shipment", entityId: shipmentId, details: `${ship.ref_no}: ${b.clearance_status || ""}`, ip });
  if (ship.assigned_to && ship.assigned_to !== user.id) {
    await notify(env, ship.assigned_to, "تحديث كمركي", `${ship.ref_no}: ${b.clearance_status || "تحديث"}`, `#/shipments/${shipmentId}`);
  }
  return ok({ message: "تم حفظ البيان الكمركي" });
}

async function customsQueue(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, s.priority, s.destination, sup.name AS supplier_name,
            c.declaration_no, c.clearance_status, c.total_fees, c.currency, c.port_arrival_date, c.free_days, c.customs_office
     FROM shipments s
     LEFT JOIN suppliers sup ON sup.id = s.supplier_id
     LEFT JOIN customs_declarations c ON c.id = (SELECT id FROM customs_declarations WHERE shipment_id=s.id ORDER BY id DESC LIMIT 1)
     WHERE s.status IN ('at_port','customs_clearance')
     ORDER BY (s.priority='urgent') DESC, s.created_at ASC`
  ).all();
  const rows = results.map((r) => ({ ...r, ...calcDemurrage(r.port_arrival_date, r.free_days) }));
  return ok({ queue: rows });
}

// =====================================================================
//  النقل
// =====================================================================
async function listTransport(env, shipmentId) {
  const { results } = await env.DB.prepare(
    `SELECT t.*, u.full_name AS created_name FROM transport_orders t
     LEFT JOIN users u ON u.id=t.created_by WHERE t.shipment_id=? ORDER BY t.id DESC`
  ).bind(shipmentId).all();
  return ok({ transport: results });
}

async function createTransport(request, env, user, shipmentId, ip) {
  if (!can(user, "writeTransport")) return err("لا تملك صلاحية النقل", 403);
  const ship = await env.DB.prepare(`SELECT id, ref_no, status, assigned_to FROM shipments WHERE id=?`).bind(shipmentId).first();
  if (!ship) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  const res = await env.DB.prepare(
    `INSERT INTO transport_orders
      (shipment_id, order_no, carrier, truck_no, driver_name, driver_phone, pickup_location,
       delivery_location, dispatch_date, delivery_date, status, cost, currency,
       booked_trailers, container_return_date, eir_received, in_storage, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    shipmentId, b.order_no || null, b.carrier || null, b.truck_no || null, b.driver_name || null,
    b.driver_phone || null, b.pickup_location || null, b.delivery_location || null,
    b.dispatch_date || null, b.delivery_date || null, b.status || "assigned", num(b.cost),
    b.currency || "USD", b.booked_trailers != null ? num(b.booked_trailers) : null,
    b.container_return_date || null, truthy(b.eir_received) ? 1 : 0, truthy(b.in_storage) ? 1 : 0,
    b.notes || null, user.id
  ).run();
  // مزامنة حالة الشحنة
  if (["dispatched", "in_transit"].includes(b.status) && ["customs_clearance","at_port"].includes(ship.status)) {
    await env.DB.prepare(`UPDATE shipments SET status='in_transport', updated_at=datetime('now') WHERE id=?`).bind(shipmentId).run();
  }
  if (b.status === "delivered") {
    await env.DB.prepare(`UPDATE shipments SET status='delivered', delivered_date=datetime('now'), updated_at=datetime('now') WHERE id=?`).bind(shipmentId).run();
  }
  await logActivity(env, { userId: user.id, action: "transport", entityType: "shipment", entityId: shipmentId, details: `${ship.ref_no}: ${b.truck_no || ""}`, ip });
  if (ship.assigned_to && ship.assigned_to !== user.id) {
    await notify(env, ship.assigned_to, "أمر نقل جديد", `${ship.ref_no}`, `#/shipments/${shipmentId}`);
  }
  return ok({ id: res.meta.last_row_id, message: "تم إنشاء أمر النقل" });
}

async function updateTransport(request, env, user, tid, ip) {
  if (!can(user, "writeTransport")) return err("لا تملك صلاحية", 403);
  const t = await env.DB.prepare(`SELECT * FROM transport_orders WHERE id=?`).bind(tid).first();
  if (!t) return err("أمر النقل غير موجود", 404);
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare(
    `UPDATE transport_orders SET order_no=?, carrier=?, truck_no=?, driver_name=?, driver_phone=?,
       pickup_location=?, delivery_location=?, dispatch_date=?, delivery_date=?, status=?, cost=?, currency=?,
       booked_trailers=?, container_return_date=?, eir_received=?, in_storage=?, notes=?, updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    b.order_no ?? t.order_no, b.carrier ?? t.carrier, b.truck_no ?? t.truck_no, b.driver_name ?? t.driver_name,
    b.driver_phone ?? t.driver_phone, b.pickup_location ?? t.pickup_location, b.delivery_location ?? t.delivery_location,
    b.dispatch_date ?? t.dispatch_date, b.delivery_date ?? t.delivery_date, b.status ?? t.status,
    b.cost != null ? num(b.cost) : t.cost, b.currency ?? t.currency,
    b.booked_trailers != null ? num(b.booked_trailers) : t.booked_trailers,
    b.container_return_date ?? t.container_return_date,
    b.eir_received != null ? (truthy(b.eir_received) ? 1 : 0) : t.eir_received,
    b.in_storage != null ? (truthy(b.in_storage) ? 1 : 0) : t.in_storage,
    b.notes ?? t.notes, tid
  ).run();
  if (b.status === "delivered") {
    await env.DB.prepare(`UPDATE shipments SET status='delivered', delivered_date=datetime('now'), updated_at=datetime('now') WHERE id=? AND status NOT IN ('closed','cancelled')`).bind(t.shipment_id).run();
  } else if (["dispatched","in_transit"].includes(b.status)) {
    await env.DB.prepare(`UPDATE shipments SET status='in_transport', updated_at=datetime('now') WHERE id=? AND status IN ('customs_clearance','at_port')`).bind(t.shipment_id).run();
  }
  await logActivity(env, { userId: user.id, action: "transport_update", entityType: "shipment", entityId: t.shipment_id, ip });
  return ok({ message: "تم تحديث أمر النقل" });
}

async function deleteTransport(env, user, tid, ip) {
  if (!can(user, "writeTransport")) return err("لا تملك صلاحية", 403);
  const t = await env.DB.prepare(`SELECT shipment_id FROM transport_orders WHERE id=?`).bind(tid).first();
  if (!t) return err("غير موجود", 404);
  await env.DB.prepare(`DELETE FROM transport_orders WHERE id=?`).bind(tid).run();
  await logActivity(env, { userId: user.id, action: "transport_delete", entityType: "shipment", entityId: t.shipment_id, ip });
  return ok({ message: "تم الحذف" });
}

async function transportQueue(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, s.priority, s.destination, sup.name AS supplier_name,
            t.truck_no, t.driver_name, t.driver_phone, t.carrier, t.status AS transport_status, t.dispatch_date, t.delivery_location
     FROM shipments s
     LEFT JOIN suppliers sup ON sup.id = s.supplier_id
     LEFT JOIN transport_orders t ON t.id = (SELECT id FROM transport_orders WHERE shipment_id=s.id ORDER BY id DESC LIMIT 1)
     WHERE s.status IN ('customs_clearance','in_transport')
     ORDER BY (s.priority='urgent') DESC, s.created_at ASC`
  ).all();
  return ok({ queue: results });
}

// =====================================================================
//  الحسابات (المالية)
// =====================================================================
async function listFinance(env, shipmentId) {
  const { results } = await env.DB.prepare(
    `SELECT f.*, u.full_name AS created_name FROM finance_records f
     LEFT JOIN users u ON u.id=f.created_by WHERE f.shipment_id=? ORDER BY f.id DESC`
  ).bind(shipmentId).all();
  return ok({ finance: results });
}

async function createFinance(request, env, user, shipmentId, ip) {
  if (!can(user, "writeFinance")) return err("لا تملك صلاحية الحسابات", 403);
  const ship = await env.DB.prepare(`SELECT id, ref_no, assigned_to FROM shipments WHERE id=?`).bind(shipmentId).first();
  if (!ship) return err("الشحنة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  if (!["cost", "invoice", "payment"].includes(b.type)) return err("نوع السجل غير صحيح", 400);
  const res = await env.DB.prepare(
    `INSERT INTO finance_records (shipment_id, type, category, description, amount, currency, record_date, due_date, status, reference_no, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    shipmentId, b.type, b.category || null, b.description || null, num(b.amount), b.currency || "USD",
    b.record_date || null, b.due_date || null, b.status || "open", b.reference_no || null, user.id
  ).run();
  await logActivity(env, { userId: user.id, action: "finance", entityType: "shipment", entityId: shipmentId, details: `${ship.ref_no}: ${b.type} ${num(b.amount)}`, ip });
  return ok({ id: res.meta.last_row_id, message: "تم حفظ السجل المالي" });
}

async function updateFinance(request, env, user, fid, ip) {
  if (!can(user, "writeFinance")) return err("لا تملك صلاحية", 403);
  const f = await env.DB.prepare(`SELECT * FROM finance_records WHERE id=?`).bind(fid).first();
  if (!f) return err("السجل غير موجود", 404);
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare(
    `UPDATE finance_records SET type=?, category=?, description=?, amount=?, currency=?, record_date=?, due_date=?, status=?, reference_no=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    b.type ?? f.type, b.category ?? f.category, b.description ?? f.description,
    b.amount != null ? num(b.amount) : f.amount, b.currency ?? f.currency,
    b.record_date ?? f.record_date, b.due_date ?? f.due_date, b.status ?? f.status, b.reference_no ?? f.reference_no, fid
  ).run();
  await logActivity(env, { userId: user.id, action: "finance_update", entityType: "shipment", entityId: f.shipment_id, ip });
  return ok({ message: "تم تحديث السجل" });
}

async function deleteFinance(env, user, fid, ip) {
  if (!can(user, "writeFinance")) return err("لا تملك صلاحية", 403);
  const f = await env.DB.prepare(`SELECT shipment_id FROM finance_records WHERE id=?`).bind(fid).first();
  if (!f) return err("غير موجود", 404);
  await env.DB.prepare(`DELETE FROM finance_records WHERE id=?`).bind(fid).run();
  await logActivity(env, { userId: user.id, action: "finance_delete", entityType: "shipment", entityId: f.shipment_id, ip });
  return ok({ message: "تم الحذف" });
}

async function financeOverview(request, env, user, url) {
  if (!can(user, "writeFinance")) return err("لا تملك صلاحية", 403);
  const totals = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type='cost' THEN amount END),0) AS total_cost,
       COALESCE(SUM(CASE WHEN type='invoice' THEN amount END),0) AS total_invoiced,
       COALESCE(SUM(CASE WHEN type='payment' THEN amount END),0) AS total_paid,
       COALESCE(SUM(CASE WHEN type='cost' AND status IN ('open','partial','overdue') THEN amount END),0) AS outstanding
     FROM finance_records`
  ).first();
  const byCategory = (await env.DB.prepare(
    `SELECT category, type, COALESCE(SUM(amount),0) AS total, COUNT(*) AS c
     FROM finance_records GROUP BY category, type ORDER BY total DESC LIMIT 50`
  ).all()).results;
  const recent = (await env.DB.prepare(
    `SELECT f.*, s.ref_no FROM finance_records f LEFT JOIN shipments s ON s.id=f.shipment_id
     ORDER BY f.id DESC LIMIT 30`
  ).all()).results;
  const byShipment = (await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.currency,
       COALESCE(SUM(CASE WHEN f.type='cost' THEN f.amount END),0) AS cost,
       COALESCE(SUM(CASE WHEN f.type='payment' THEN f.amount END),0) AS paid
     FROM shipments s JOIN finance_records f ON f.shipment_id=s.id
     GROUP BY s.id ORDER BY cost DESC LIMIT 20`
  ).all()).results;
  return ok({ totals, by_category: byCategory, recent, by_shipment: byShipment });
}

// =====================================================================
//  الناقلون
// =====================================================================
async function listCarriers(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM carriers ORDER BY kind DESC, name COLLATE NOCASE`).all();
  return ok({ carriers: results });
}
async function createCarrier(request, env, user, ip) {
  if (!can(user, "writeCarriers")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  if (!b.name) return err("اسم الناقل مطلوب", 400);
  const res = await env.DB.prepare(
    `INSERT INTO carriers (name, kind, phone, notes, created_by) VALUES (?,?,?,?,?)`
  ).bind(b.name, b.kind || "subcontractor", b.phone || null, b.notes || null, user.id).run();
  await logActivity(env, { userId: user.id, action: "create", entityType: "carrier", entityId: res.meta.last_row_id, details: b.name, ip });
  return ok({ id: res.meta.last_row_id, message: "تم إضافة الناقل" });
}
async function updateCarrier(request, env, user, id, ip) {
  if (!can(user, "writeCarriers")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  const t = await env.DB.prepare(`SELECT * FROM carriers WHERE id=?`).bind(id).first();
  if (!t) return err("الناقل غير موجود", 404);
  await env.DB.prepare(
    `UPDATE carriers SET name=?, kind=?, phone=?, notes=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).bind(b.name ?? t.name, b.kind ?? t.kind, b.phone ?? t.phone, b.notes ?? t.notes,
    b.active != null ? (b.active ? 1 : 0) : t.active, id).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "carrier", entityId: id, ip });
  return ok({ message: "تم تحديث الناقل" });
}
async function deleteCarrier(env, user, id, ip) {
  if (!can(user, "writeCarriers")) return err("لا تملك صلاحية", 403);
  await env.DB.prepare(`UPDATE carriers SET active=0, updated_at=datetime('now') WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "carrier", entityId: id, ip });
  return ok({ message: "تم حذف الناقل" });
}

// =====================================================================
//  الغرامات (غرامات الخطوط الملاحية)
// =====================================================================
async function listShipmentPenalties(env, shipmentId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM penalties WHERE shipment_id=? ORDER BY id DESC`
  ).bind(shipmentId).all();
  return ok({ penalties: results });
}
async function listPenalties(env, user) {
  if (!can(user, "writePenalties")) return err("لا تملك صلاحية", 403);
  const { results } = await env.DB.prepare(
    `SELECT p.*, s.ref_no AS shipment_ref_no FROM penalties p
     LEFT JOIN shipments s ON s.id=p.shipment_id ORDER BY p.id DESC LIMIT 500`
  ).all();
  const byCurrency = {};
  for (const r of results) { const c = r.currency || "IQD"; byCurrency[c] = (byCurrency[c] || 0) + (r.penalty_amount || 0); }
  return ok({ penalties: results, total: results.length, by_currency: byCurrency });
}
async function createPenalty(request, env, user, ip) {
  if (!can(user, "writePenalties")) return err("لا تملك صلاحية", 403);
  const b = await request.json().catch(() => ({}));
  let shipmentId = b.shipment_id || null;
  // ربط تلقائي بالشحنة عبر رقم المرجع إن لم يُحدّد
  if (!shipmentId && b.shipment_ref) {
    const s = await env.DB.prepare(`SELECT id FROM shipments WHERE ref_no=?`).bind(b.shipment_ref).first();
    if (s) shipmentId = s.id;
  }
  const res = await env.DB.prepare(
    `INSERT INTO penalties (shipment_id, shipment_ref, client, shipping_line, agent, type_of_entry, penalty_amount, currency, do_receipt, submission_date, pic, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(shipmentId, b.shipment_ref || null, b.client || null, b.shipping_line || null, b.agent || null,
    b.type_of_entry || null, num(b.penalty_amount), b.currency || "IQD", truthy(b.do_receipt) ? 1 : 0,
    b.submission_date || null, b.pic || null, b.notes || null, user.id).run();
  await logActivity(env, { userId: user.id, action: "create", entityType: "penalty", entityId: res.meta.last_row_id, details: b.shipment_ref || "", ip });
  return ok({ id: res.meta.last_row_id, message: "تم تسجيل الغرامة" });
}
async function updatePenalty(request, env, user, id, ip) {
  if (!can(user, "writePenalties")) return err("لا تملك صلاحية", 403);
  const t = await env.DB.prepare(`SELECT * FROM penalties WHERE id=?`).bind(id).first();
  if (!t) return err("الغرامة غير موجودة", 404);
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare(
    `UPDATE penalties SET shipment_ref=?, client=?, shipping_line=?, agent=?, type_of_entry=?, penalty_amount=?, currency=?, do_receipt=?, submission_date=?, pic=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).bind(b.shipment_ref ?? t.shipment_ref, b.client ?? t.client, b.shipping_line ?? t.shipping_line,
    b.agent ?? t.agent, b.type_of_entry ?? t.type_of_entry, b.penalty_amount != null ? num(b.penalty_amount) : t.penalty_amount,
    b.currency ?? t.currency, b.do_receipt != null ? (truthy(b.do_receipt) ? 1 : 0) : t.do_receipt,
    b.submission_date ?? t.submission_date, b.pic ?? t.pic, b.notes ?? t.notes, id).run();
  await logActivity(env, { userId: user.id, action: "update", entityType: "penalty", entityId: id, ip });
  return ok({ message: "تم تحديث الغرامة" });
}
async function deletePenalty(env, user, id, ip) {
  if (!can(user, "writePenalties")) return err("لا تملك صلاحية", 403);
  await env.DB.prepare(`DELETE FROM penalties WHERE id=?`).bind(id).run();
  await logActivity(env, { userId: user.id, action: "delete", entityType: "penalty", entityId: id, ip });
  return ok({ message: "تم حذف الغرامة" });
}

// =====================================================================
//  الإشعارات
// =====================================================================
async function listNotifications(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`
  ).bind(user.id).all();
  const unread = results.filter((n) => !n.is_read).length;
  return ok({ notifications: results, unread });
}

async function readNotification(env, user, id) {
  await env.DB.prepare(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`).bind(id, user.id).run();
  return ok({ message: "تم" });
}

async function readAllNotifications(env, user) {
  await env.DB.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).bind(user.id).run();
  return ok({ message: "تم" });
}

// =====================================================================
//  لوحة المعلومات
// =====================================================================
async function dashboard(env, user) {
  const byStatus = (await env.DB.prepare(
    `SELECT status, COUNT(*) AS c FROM shipments GROUP BY status`
  ).all()).results;

  const totals = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM shipments) AS total_shipments,
       (SELECT COUNT(*) FROM shipments WHERE status NOT IN ('closed','cancelled')) AS active_shipments,
       (SELECT COUNT(*) FROM suppliers WHERE active=1) AS total_suppliers,
       (SELECT COUNT(*) FROM users WHERE active=1) AS total_users`
  ).first();

  const recent = (await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, s.priority, s.created_at, sup.name AS supplier_name
     FROM shipments s LEFT JOIN suppliers sup ON sup.id=s.supplier_id
     ORDER BY s.created_at DESC LIMIT 8`
  ).all()).results;

  const myTasks = (await env.DB.prepare(
    `SELECT id, ref_no, title, status, priority, eta FROM shipments
     WHERE assigned_to=? AND status NOT IN ('closed','cancelled')
     ORDER BY (priority='urgent') DESC, eta ASC LIMIT 10`
  ).bind(user.id).all()).results;

  return ok({ by_status: byStatus, totals, recent, my_tasks: myTasks });
}

// =====================================================================
//  التقارير والتحليلات
// =====================================================================
async function reports(env, user) {
  if (!can(user, "viewReports")) return err("لا تملك صلاحية", 403);
  const byStatus = (await env.DB.prepare(`SELECT status, COUNT(*) AS c FROM shipments GROUP BY status ORDER BY c DESC`).all()).results;
  const byClient = (await env.DB.prepare(
    `SELECT cl.name AS client, COUNT(*) AS c FROM shipments s JOIN clients cl ON cl.id=s.client_id GROUP BY cl.id ORDER BY c DESC LIMIT 20`
  ).all()).results;
  const byMonth = (await env.DB.prepare(
    `SELECT substr(eta,1,7) AS month, COUNT(*) AS c FROM shipments WHERE eta IS NOT NULL AND length(eta)>=7 GROUP BY month ORDER BY month DESC LIMIT 24`
  ).all()).results;
  const penByLine = (await env.DB.prepare(
    `SELECT COALESCE(shipping_line,'غير محدد') AS line, COUNT(*) AS c, COALESCE(SUM(penalty_amount),0) AS total FROM penalties GROUP BY line ORDER BY total DESC LIMIT 15`
  ).all()).results;
  const penByClient = (await env.DB.prepare(
    `SELECT COALESCE(client,'غير محدد') AS client, COUNT(*) AS c, COALESCE(SUM(penalty_amount),0) AS total FROM penalties GROUP BY client ORDER BY total DESC LIMIT 15`
  ).all()).results;
  const totals = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM shipments) AS shipments,
            (SELECT COUNT(*) FROM shipments WHERE status NOT IN ('closed','cancelled')) AS active,
            (SELECT COUNT(*) FROM clients WHERE active=1) AS clients,
            (SELECT COUNT(*) FROM customs_operations) AS customs_ops,
            (SELECT COUNT(*) FROM penalties) AS penalties,
            (SELECT COALESCE(SUM(penalty_amount),0) FROM penalties) AS penalties_total,
            (SELECT COUNT(*) FROM shipments WHERE eta IS NOT NULL AND length(eta)>=7) AS with_eta`
  ).first();
  return ok({ by_status: byStatus, by_client: byClient, by_month: byMonth, pen_by_line: penByLine, pen_by_client: penByClient, totals });
}

// =====================================================================
//  سجل النشاط
// =====================================================================
async function listActivity(request, env, user, url) {
  if (!can(user, "manageUsers")) return err("لا تملك صلاحية", 403);
  const limit = Math.min(200, parseInt(url.searchParams.get("limit") || "100", 10));
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.full_name AS user_name FROM activity_log a
     LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ?`
  ).bind(limit).all();
  return ok({ activity: results });
}

// =====================================================================
//  جودة البيانات (يكشف الناقص للموظفين ليُكملوه)
// =====================================================================
async function dataQuality(env, user){
  if(!can(user,"writeShipments") && !can(user,"manageUsers")) return err("لا تملك صلاحية", 403);
  const W = "WHERE s.status NOT IN ('closed','cancelled')";
  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN s.assigned_to IS NULL THEN 1 ELSE 0 END) AS no_assigned,
       SUM(CASE WHEN s.shipping_line IS NULL OR s.shipping_line='' THEN 1 ELSE 0 END) AS no_line,
       SUM(CASE WHEN s.eta IS NULL THEN 1 ELSE 0 END) AS no_eta,
       SUM(CASE WHEN s.client_id IS NULL THEN 1 ELSE 0 END) AS no_client,
       SUM(CASE WHEN s.bl_no IS NULL OR s.bl_no='' THEN 1 ELSE 0 END) AS no_bl,
       SUM(CASE WHEN s.container_no IS NULL OR s.container_no='' THEN 1 ELSE 0 END) AS no_container,
       SUM(CASE WHEN s.destination IS NULL OR s.destination='' THEN 1 ELSE 0 END) AS no_destination
     FROM shipments s ${W}`
  ).first();
  const list = async (cond) => (await env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, c.name AS client_name, u.full_name AS assigned_name
     FROM shipments s LEFT JOIN clients c ON c.id=s.client_id LEFT JOIN users u ON u.id=s.assigned_to
     ${W} AND ${cond} ORDER BY s.created_at DESC LIMIT 100`
  ).all()).results;
  const lists = {
    no_assigned: await list("s.assigned_to IS NULL"),
    no_line: await list("(s.shipping_line IS NULL OR s.shipping_line='')"),
    no_eta: await list("s.eta IS NULL"),
    no_client: await list("s.client_id IS NULL"),
    no_bl: await list("(s.bl_no IS NULL OR s.bl_no='')"),
  };
  return ok({ summary, lists });
}

// =====================================================================
//  حالة المزامنة وسجل التغييرات (للمدير)
// =====================================================================
async function syncStatus(env, user){
  if(!can(user,"manageUsers")) return err("لا تملك صلاحية", 403);
  const recent=(await env.DB.prepare(`SELECT source, inserted, updated, skipped, errors, created_at FROM sync_log ORDER BY id DESC LIMIT 20`).all()).results;
  const last=await env.DB.prepare(`SELECT created_at FROM sync_log ORDER BY id DESC LIMIT 1`).first();
  const today=await env.DB.prepare(`SELECT COALESCE(SUM(inserted),0) AS ins, COALESCE(SUM(updated),0) AS upd, COALESCE(SUM(errors),0) AS err, COUNT(*) AS posts FROM sync_log WHERE created_at > datetime('now','-1 day')`).first();
  const changesToday=await env.DB.prepare(`SELECT COUNT(*) AS c FROM change_log WHERE created_at > datetime('now','-1 day')`).first();
  return ok({ last: last?last.created_at:null, recent, today, changes_today: changesToday.c });
}
async function syncChanges(request, env, user, url){
  if(!can(user,"manageUsers")) return err("لا تملك صلاحية", 403);
  const limit=Math.min(200, parseInt(url.searchParams.get("limit")||"80",10));
  const { results } = await env.DB.prepare(`SELECT * FROM change_log ORDER BY id DESC LIMIT ?`).bind(limit).all();
  return ok({ changes: results });
}
async function syncEdits(request, env, user, url){
  if(!can(user,"manageUsers")) return err("لا تملك صلاحية", 403);
  const limit=Math.min(200, parseInt(url.searchParams.get("limit")||"80",10));
  const { results } = await env.DB.prepare(`SELECT * FROM edit_log ORDER BY id DESC LIMIT ?`).bind(limit).all();
  return ok({ edits: results });
}
// استقبال تعديل مباشر من Google Sheets (onEdit) — محمي برمز
async function ingestEdit(request, env){
  const token=request.headers.get("X-Sync-Token")||"";
  if(!env.SYNC_TOKEN || token.trim()!==env.SYNC_TOKEN.trim()) return err("رمز المزامنة غير صحيح", 403);
  const b=await request.json().catch(()=>null);
  if(!b) return err("صيغة غير صحيحة", 400);
  try{
    await env.DB.prepare(`INSERT INTO edit_log (editor, spreadsheet, tab, ref_no, column_header, old_value, new_value, row_num) VALUES (?,?,?,?,?,?,?,?)`)
      .bind((b.editor||"").slice(0,160)||null, (b.spreadsheet||"").slice(0,160)||null, (b.tab||"").slice(0,120)||null,
        (b.ref||"").slice(0,120)||null, (b.column||"").slice(0,120)||null,
        (b.oldValue==null?null:String(b.oldValue).slice(0,500)), (b.newValue==null?null:String(b.newValue).slice(0,500)),
        b.row?parseInt(b.row,10):null).run();
  }catch(e){ return err("فشل التسجيل: "+e.message, 500); }
  return ok({ message:"logged" });
}

// =====================================================================
//  مزامنة Google Sheets → MASAR (التوجيه + التحويل + كشف التغيير)
// =====================================================================
const GS_MO = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
function gsDate(v) {
  if (v == null) return null;
  const s = String(v).trim(); if (!s) return null;
  let m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3,})[-\/ ](\d{4})$/);
  if (m) { const mo = GS_MO[m[2].slice(0,3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[1].padStart(2,"0")}`; }
  m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return null;
}
function gsNum(v) { if (v == null) return null; const s = String(v).replace(/[^\d.\-]/g,""); if (s===""||s==="-") return null; const n = Number(s); return isNaN(n)?null:n; }
function gsInt(v) { const n = gsNum(v); return n==null?null:Math.round(n); }
function gsMoney(v) { if (!v) return { amt:null, cur:null }; const s=String(v); const cur=(s.match(/IQD|USD|EUR|AED/i)||[null])[0]; return { amt:gsNum(s), cur:cur?cur.toUpperCase():null }; }
function gsImport(v) { const s=String(v||"").toLowerCase(); if(s.includes("perm"))return"permanent"; if(s.includes("ddp"))return"ddp"; if(s.includes("temp"))return"temporary"; if(s.includes("re-ex")||s.includes("reex"))return"reexport"; if(s.includes("licen"))return"import_license"; if(s.includes("renew"))return"renewal"; if(s.includes("cour"))return"courier"; return null; }
function gsMode(v) { const s=String(v||"").toLowerCase(); if(s.includes("sea"))return"sea"; if(s.includes("air"))return"air"; if(s.includes("land")||s.includes("road"))return"land"; return null; }
function gsStatus(v) { const s=String(v||"").toLowerCase(); if(s.includes("cancel")||s.includes("ملغ"))return"cancelled"; if(s.includes("deliver")||s.includes("تسليم")||s.includes("سلم"))return"delivered"; return"opened"; }
// استنتاج ذكي للحالة من المحطات الزمنية + النص (الأكمل أولاً)
function inferStatus(textStatus, f){
  const t=String(textStatus||"").toLowerCase();
  if(t.includes("cancel")||t.includes("ملغ")) return "cancelled";
  if(f.accounting_invoice_date || f.finance_settlement_date) return "closed";
  if(f.offloading_pod_date || f.arrival_site_date || t.includes("deliver")||t.includes("تسليم")||t.includes("سلم")) return "delivered";
  if(f.loading_date || f.releasing_date) return "in_transport";
  if(f.cc_receipt_date) return "customs_clearance";
  if(f.vessel_ata || f.do1_date) return "at_port";
  return "opened";
}
// ربط اسم PIC بحساب الموظف
function normPic(s){ return String(s||"").toLowerCase().replace(/[^a-z]/g,""); }
const PIC_ALIASES = { mohmed:"mohamed", mohamad:"mohamed", mohammed:"mohamed", ishraqq:"ishraq" };
async function loadPicMap(env){
  const map=new Map();
  const { results } = await env.DB.prepare(`SELECT id, username FROM users WHERE active=1`).all();
  for(const u of results){ const k=normPic(u.username); if(k) map.set(k, u.id); }
  return map;
}
function resolvePic(picMap, name){
  if(!picMap) return null;
  let k=normPic(name); if(!k) return null;
  if(PIC_ALIASES[k]) k=PIC_ALIASES[k];
  return picMap.get(k) || null;
}
function gsBool(v){ return /^(true|1|yes|نعم|y)$/i.test(String(v||"").trim()); }
function gsClean(v){ if(v==null) return null; const s=String(v).replace(/\s+/g," ").trim(); if(!s||/^(na|n\/a|true|false)$/i.test(s)) return null; return s; }
// getter بتطابق جزئي لاسم العمود (للعناوين ثنائية اللغة)
function gp(row, ...subs){ for(const s of subs){ const k=Object.keys(row).find(k=>k.includes(s)); if(k && String(row[k]).trim()!=="") return row[k]; } return ""; }
async function sha256hex(str){ const b=await crypto.subtle.digest("SHA-256", enc.encode(str)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }

async function dbInsert(env, table, fields){
  const cols=Object.keys(fields), vals=cols.map(c=>fields[c]);
  const res=await env.DB.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).bind(...vals).run();
  return res.meta.last_row_id;
}
async function dbUpdate(env, table, fields, id){
  const cols=Object.keys(fields), vals=cols.map(c=>fields[c]);
  await env.DB.prepare(`UPDATE ${table} SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
}
async function ensureClient(env, name, cache){
  name = gsClean(name); if(!name) return null;
  if(cache && cache.has(name)) return cache.get(name);
  await env.DB.prepare(`INSERT INTO clients (name, created_by) SELECT ?,1 WHERE NOT EXISTS (SELECT 1 FROM clients WHERE name=?)`).bind(name,name).run();
  const r=await env.DB.prepare(`SELECT id FROM clients WHERE name=? LIMIT 1`).bind(name).first();
  const id=r?r.id:null; if(cache) cache.set(name,id); return id;
}
async function ensureCarrier(env, name){
  name=gsClean(name); if(!name) return name;
  await env.DB.prepare(`INSERT INTO carriers (name, created_by) SELECT ?,1 WHERE NOT EXISTS (SELECT 1 FROM carriers WHERE name=?)`).bind(name,name).run();
  return name;
}
function diffFields(oldRow, fields){
  const ch={}; if(!oldRow) return ch;
  const skip=new Set(["created_by","updated_at","created_at","id","client_id","assigned_to","status"]);
  for(const k of Object.keys(fields)){
    if(skip.has(k)) continue;
    const o=oldRow[k]==null?"":String(oldRow[k]);
    const n=fields[k]==null?"":String(fields[k]);
    if(o!==n) ch[k]={old:oldRow[k]??null, new:fields[k]??null};
  }
  return ch;
}

// المزامنة الموحّدة: insert/update عبر sync_state + مطابقة الموجود + تسجيل التغيير
async function syncOne(env, key, hash, entityType, fields, table, reconcileId, meta){
  const st=await env.DB.prepare(`SELECT hash, entity_id FROM sync_state WHERE sync_key=?`).bind(key).first();
  if(st && st.hash===hash) return "skip";
  let id = st ? st.entity_id : null;
  let wasUpdate = !!st;
  if(!id && reconcileId){ const ex=await reconcileId(); if(ex){ id=ex; wasUpdate=true; } }
  let changed=null;
  if(id){
    const old=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
    changed=diffFields(old, fields);
    await dbUpdate(env, table, fields, id);
  } else { id = await dbInsert(env, table, fields); }
  await env.DB.prepare(`INSERT INTO sync_state (sync_key,hash,entity_type,entity_id) VALUES (?,?,?,?)
    ON CONFLICT(sync_key) DO UPDATE SET hash=excluded.hash, entity_id=excluded.entity_id, updated_at=datetime('now')`).bind(key,hash,entityType,id).run();
  const action = wasUpdate ? "update" : "insert";
  if(meta && (action==="insert" || (changed && Object.keys(changed).length>0))){
    try{ await env.DB.prepare(`INSERT INTO change_log (entity_type, entity_id, ref_no, action, pic, changed_fields, source) VALUES (?,?,?,?,?,?,?)`)
      .bind(entityType, id, meta.ref||null, action, meta.pic||null, changed?JSON.stringify(changed).slice(0,2000):null, meta.source||null).run(); }catch(_){}
  }
  return action;
}

function routeTab(name, headers){
  const n=String(name||"").trim().toLowerCase();
  const has=(s)=>headers.some(h=>String(h).includes(s));
  if(n.includes("customs operations")) return "customs_op";
  if(n==="booking") return "transport";
  if(has("Penalty Amount")) return "penalty";
  if(has("Shipment Ref. #")) return "shipment";
  return "none";
}

async function ingestSync(request, env){
  const token=request.headers.get("X-Sync-Token")||"";
  if(!env.SYNC_TOKEN || token.trim()!==env.SYNC_TOKEN.trim()) return err("رمز المزامنة غير صحيح", 403);
  const body=await request.json().catch(()=>null);
  if(!body || !Array.isArray(body.sheets)) return err("صيغة غير صحيحة (sheets مطلوب)", 400);
  const stats={ inserted:0, updated:0, skipped:0, errors:0, tabs:{} };
  const clientCache=new Map();
  const picMap=await loadPicMap(env);
  for(const sheet of body.sheets){
    try{
      const headers=(sheet.headers||[]).map(h=>String(h==null?"":h).trim());
      const rows=(sheet.rows||[]).map(r=>{ const o={}; headers.forEach((h,i)=>{ if(h) o[h]=r[i]; }); return o; });
      const type=routeTab(sheet.name, headers);
      let res={ins:0,upd:0,skip:0};
      if(type==="shipment") res=await syncShipments(env, sheet.name, rows, clientCache, picMap);
      else if(type==="customs_op") res=await syncCustomsOps(env, rows, clientCache, sheet.name);
      else if(type==="penalty") res=await syncPenalties(env, rows, sheet.name);
      else if(type==="transport") res=await syncTransport(env, rows, sheet.name);
      else { stats.tabs[sheet.name]="تخطّي"; continue; }
      stats.inserted+=res.ins; stats.updated+=res.upd; stats.skipped+=res.skip;
      stats.tabs[sheet.name]=`+${res.ins} ~${res.upd} =${res.skip}`;
    }catch(e){ stats.errors++; stats.tabs[sheet.name]="خطأ: "+(e.message||e); }
  }
  // سجّل فقط عند وجود تغيير فعلي أو خطأ (يمنع تضخّم السجل)
  if(stats.inserted || stats.updated || stats.errors){
    try{ await env.DB.prepare(`INSERT INTO sync_log (source, inserted, updated, skipped, errors, detail) VALUES (?,?,?,?,?,?)`)
      .bind(body.source||null, stats.inserted, stats.updated, stats.skipped, stats.errors, JSON.stringify(stats.tabs).slice(0,1800)).run(); }catch(_){}
  }
  // تنظيف تلقائي للسجلات القديمة (فرصة منخفضة لتفادي العبء)
  if(Math.random() < 0.03){
    try{ await env.DB.batch([
      env.DB.prepare(`DELETE FROM sync_log WHERE created_at < datetime('now','-30 days')`),
      env.DB.prepare(`DELETE FROM change_log WHERE created_at < datetime('now','-60 days')`),
      env.DB.prepare(`DELETE FROM edit_log WHERE created_at < datetime('now','-60 days')`),
      env.DB.prepare(`DELETE FROM activity_log WHERE created_at < datetime('now','-90 days')`),
    ]); }catch(_){}
  }
  return ok({ message:"تمت المزامنة", ...stats });
}

const SPECIAL_TABS=["spot shipment","re-export","inter. re-export"];
async function syncShipments(env, tabName, rows, clientCache, picMap){
  let ins=0,upd=0,skip=0;
  const isSpecial=SPECIAL_TABS.includes(String(tabName||"").trim().toLowerCase());
  const isReexport=String(tabName||"").toLowerCase().includes("re-export");
  for(const r of rows){
    const ref=(gsClean(r["Shipment Ref. #"])|| (gsClean(r["BL #"])?("BL-"+gsClean(r["BL #"])):null));
    if(!ref) continue;
    const clientName = gsClean(r["Client"]) || (isSpecial?null:tabName);
    const clientId = await ensureClient(env, clientName, clientCache);
    const cargo=gsClean(r["Cargo Description"]);
    const notesParts=[];
    if(gsClean(r["Status"])) notesParts.push("حالة الشيت: "+gsClean(r["Status"]));
    if(gsClean(r["Remarks"])) notesParts.push("ملاحظات: "+gsClean(r["Remarks"]));
    if(gsClean(r["PIC"])) notesParts.push("PIC: "+gsClean(r["PIC"]));
    if(gsClean(r["Hs Code"])) notesParts.push("HS: "+gsClean(r["Hs Code"]));
    const dep=gsMoney(r["SL Deposit"]);
    const f={
      ref_no:ref, title:(cargo?cargo.slice(0,80):ref), client_id:clientId,
      status:gsStatus(r["Status"]), importation_type:(isReexport?"reexport":gsImport(r["Importation Type"])),
      transport_mode:gsMode(r["Mode"]), shipping_line:gsClean(r["Shipping Line Agent"]),
      destination:gsClean(r["Destination"]), bl_no:gsClean(r["BL #"]), container_no:gsClean(r["Container#"]),
      vessel_name:gsClean(r["VSL name and VOY#"]), goods_description:cargo,
      call_off:gsClean(r["Call Off"]), call_off_date:gsDate(r["Call Off Date"]),
      eta:gsDate(r["Vessel ETA"]), etd:gsDate(r["Vessel ETD"]), vessel_ata:gsDate(r["Vessel ATA"]),
      docs_submission_date:gsDate(r["Docs Submission Date"]), do1_date:gsDate(r["1st DO Date"]),
      do2_date:gsDate(r["2nd DO Date"]), do2_no:gsClean(r["2nd DO #"]),
      trailer_booking_date:gsDate(r["Trailer Booking Date"]), trailer_entry_date:gsDate(r["Trailer Entry Date"]),
      loading_date:gsDate(r["Loading Date"]), releasing_date:gsDate(r["Releasing Date"]),
      arrival_site_date:gsDate(r["Arrival to Site Date"]),
      offloading_pod_date:gsDate(r["Off Loading/POD Date"]||r["Off loading / POD Date"]),
      return_token_date:gsDate(r["Return Token Date"]), cc_receipt_date:gsDate(r["CC Receipt Receive Date"]),
      finance_settlement_date:gsDate(r["Finance Settlement Date"]),
      handover_account_date:gsDate(r["HandOver Receipt and Docs to Account dept."]),
      accounting_invoice_date:gsDate(r["Accounting Invoice to Client Date"]),
      deposit_receipt_date:gsDate(r["Deposit Receipt Receive Date"]),
      cont_20std:gsInt(r["20 STD"]||r["20"]), cont_20fr:gsInt(r["20 FR"]), cont_20ot:gsInt(r["20 OT"]),
      cont_40std:gsInt(r["40 STD"]||r["40"]), cont_40fr:gsInt(r["40 FR"]), cont_40ot:gsInt(r["40 OT"]),
      cont_45:gsInt(r["45 STD"]||r["45"]), lcl:gsInt(r["LCL"]), roro:gsInt(r["RORO"]),
      cbm:gsNum(r["CBM"]), weight_kg:gsNum(r["GW"]), total_pkgs:gsInt(r["Total PKGs if BB"]),
      total_trailers:gsInt(r["Total required Trailers"]||r["Total Trailers"]), packaging_type:gsClean(r["Type of Packaging"]),
      sl_deposit:dep.amt, deposit_currency:dep.cur, sl_deducted:gsMoney(r["Amount Deducted"]).amt, sl_returned:gsMoney(r["Returned Balance"]).amt,
      pre_alert_date:gsDate(r["Pre-alert Recieved from Client"]), docs_to_org_date:gsDate(r["Docs Submitted to Operation Org."]),
      exemption_approval:gsClean(r["Exemption Approval"]), transit_through:gsClean(r["Through"]),
      notes:(notesParts.join(" | ").slice(0,900)||null), created_by:1,
    };
    // استنتاج الحالة الذكي من المحطات + ربط المسؤول بحساب الموظف
    f.status = inferStatus(r["Status"], f);
    f.assigned_to = resolvePic(picMap, r["PIC"]);
    const key="shipment:"+ref;
    const hash=await sha256hex(JSON.stringify(f));
    const res=await syncOne(env, key, hash, "shipment", f, "shipments",
      async()=>{ const e=await env.DB.prepare(`SELECT id FROM shipments WHERE ref_no=?`).bind(ref).first(); return e?e.id:null; },
      { ref, pic:gsClean(r["PIC"]), source:tabName });
    if(res==="insert")ins++; else if(res==="update")upd++; else skip++;
  }
  return {ins,upd,skip};
}

async function syncCustomsOps(env, rows, clientCache, source){
  let ins=0,upd=0,skip=0;
  for(const r of rows){
    const abr=gsClean(r["ABR Ref#"]); const cd=gsClean(r["CD #"]); const lb=gsClean(r["LB #"]);
    if(!abr && !cd && !lb) continue;
    const handover=gsBool(r["Hand Overed to Client?"]); const inv=gsDate(r["Invoice to Client Date"]);
    const status=(handover||inv)?"done":(gsDate(r["Process Start Date"])?"in_progress":"open");
    const f={
      abr_ref:abr, job_type:gsClean(r["Job Type"]), client_id:await ensureClient(env, r["Client"], clientCache),
      pic:gsClean(r["PIC"]), operation_org:gsClean(r["Operation Organisation"]), oil_company:gsClean(r["Oil Company"]),
      contract_no:gsClean(r["Contract#"]), qty_cdlb:gsClean(gp(r,"QTY")),
      cd_no:cd, cd_last_expire:gsDate(r["CD Last Expire Date"]), cd_new_expire:gsDate(r["CD New Expire Date"]),
      lb_no:lb, lb_last_expire:gsDate(r["LB Last Expire Date"]), lb_new_expire:gsDate(r["LB New Expire Date"]),
      process_start_date:gsDate(r["Process Start Date"]), process_end_date:gsDate(r["Process End Date"]),
      handover_to_client:handover?1:0, pod_signed:gsBool(r["POD Signed?"])?1:0,
      handover_account_date:gsDate(gp(r,"Hand Over Date")), receive_account_date:gsDate(gp(r,"Recieve from Ac","Receive from Ac")),
      invoice_client_date:inv, status, notes:gsClean(r["Process Updates"]), created_by:1,
    };
    const key="custop:"+(abr||"")+"|"+(cd||"")+"|"+(lb||"");
    const hash=await sha256hex(JSON.stringify(f));
    const res=await syncOne(env, key, hash, "customs_op", f, "customs_operations",
      async()=>{ const e=await env.DB.prepare(`SELECT id FROM customs_operations WHERE abr_ref IS ? AND cd_no IS ? AND lb_no IS ? LIMIT 1`).bind(abr,cd,lb).first(); return e?e.id:null; },
      { ref:abr, pic:gsClean(r["PIC"]), source });
    if(res==="insert")ins++; else if(res==="update")upd++; else skip++;
  }
  return {ins,upd,skip};
}

async function syncPenalties(env, rows, source){
  let ins=0,upd=0,skip=0;
  for(const r of rows){
    const ref=gsClean(gp(r,"Shipment Ref")); const amt=gsNum(gp(r,"Penalty Amount"));
    if(!ref && amt==null) continue;
    let shipmentId=null;
    if(ref){ const s=await env.DB.prepare(`SELECT id FROM shipments WHERE ref_no=?`).bind(ref).first(); shipmentId=s?s.id:null; }
    const sub=gsDate(gp(r,"تاريخ التقديم","Submission"));
    const f={
      shipment_id:shipmentId, shipment_ref:ref, client:gsClean(r["Client"]),
      shipping_line:gsClean(gp(r,"Shipping Line")), agent:gsClean(gp(r,"الوكالة","اسم الوكالة")),
      type_of_entry:gsClean(r["Type of Entry"]), penalty_amount:(amt==null?0:amt), currency:"IQD",
      do_receipt:gsBool(gp(r,"امر التسليم","الوصل"))?1:0, submission_date:sub, pic:gsClean(r["PIC"]), created_by:1,
    };
    const key="penalty:"+(ref||"")+"|"+(amt==null?"":amt)+"|"+(sub||"");
    const hash=await sha256hex(JSON.stringify(f));
    const res=await syncOne(env, key, hash, "penalty", f, "penalties", null,
      { ref, pic:gsClean(r["PIC"]), source });
    if(res==="insert")ins++; else if(res==="update")upd++; else skip++;
  }
  return {ins,upd,skip};
}

const GS_CARRIERS=[["سيارات عبر الشرق","سيارات عبر الشرق"],["عبدالله","الناقل عبدالله"],["علي نجيب","علي نجيب"],["راجي","راجي"],["سيف","سيف"],["علي راضي","علي راضي"],["أبو حيدر","أبو حيدر"],["بيت الهارف","بيت الهارف"]];
async function syncTransport(env, rows, source){
  let ins=0,upd=0,skip=0;
  for(const r of rows){
    const ref=gsClean(gp(r,"Shipment #","Shipment"));
    if(!ref) continue;
    const s=await env.DB.prepare(`SELECT id FROM shipments WHERE ref_no=?`).bind(ref).first();
    const shipmentId=s?s.id:null;
    const dispatch=gsDate(gp(r,"دخول السيارة")); const deliver=gsDate(gp(r,"الوصول للموقع"));
    const cret=gsDate(gp(r,"Container Return")); const pod=gsDate(gp(r,"التفريغ وتوقيع"));
    const status=pod?"delivered":(dispatch?"in_transit":"assigned");
    const dest=gsClean(gp(r,"Destination","مكان التفريغ"));
    const notes=[gsClean(r["DO#"])?("DO: "+gsClean(r["DO#"])):"", gsClean(r["الملاحظات"])||""].filter(Boolean).join(" | ")||null;
    let made=false;
    for(const [colSub, cname] of GS_CARRIERS){
      const cnt=gsInt(gp(r, colSub)); if(!cnt) continue;
      await ensureCarrier(env, cname);
      const f={ shipment_id:shipmentId, carrier:cname, booked_trailers:cnt, delivery_location:dest,
        dispatch_date:dispatch, delivery_date:deliver, container_return_date:cret,
        eir_received:gp(r,"EIR")?1:0, in_storage:gsBool(gp(r,"In Storage","في الخزن"))?1:0, status, notes, created_by:1 };
      const key="transport:"+ref+"|"+cname;
      const hash=await sha256hex(JSON.stringify(f));
      const res=await syncOne(env, key, hash, "transport", f, "transport_orders", null,
        { ref, pic:gsClean(gp(r,"PIC")), source });
      if(res==="insert")ins++; else if(res==="update")upd++; else skip++;
      made=true;
    }
    if(!made){
      const f={ shipment_id:shipmentId, booked_trailers:gsInt(gp(r,"Total Trailers")), delivery_location:dest,
        dispatch_date:dispatch, delivery_date:deliver, container_return_date:cret,
        eir_received:gp(r,"EIR")?1:0, in_storage:gsBool(gp(r,"In Storage","في الخزن"))?1:0, status, notes, created_by:1 };
      const key="transport:"+ref+"|_";
      const hash=await sha256hex(JSON.stringify(f));
      const res=await syncOne(env, key, hash, "transport", f, "transport_orders", null,
        { ref, pic:gsClean(gp(r,"PIC")), source });
      if(res==="insert")ins++; else if(res==="update")upd++; else skip++;
    }
  }
  return {ins,upd,skip};
}
