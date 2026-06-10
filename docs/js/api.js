/**
 * طبقة الاتصال بالـ API + إدارة الجلسة (التوكن)
 */
import { CONFIG } from "./config.js";

const TOKEN_KEY = "masar_token";
const USER_KEY = "masar_user";

export const Session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  set user(u) { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); },
  clear() { this.token = null; this.user = null; },
  get isAuthed() { return !!this.token; },
};

async function request(method, path, body, isForm = false) {
  const headers = {};
  if (Session.token) headers["Authorization"] = `Bearer ${Session.token}`;
  let payload;
  if (isForm) {
    payload = body; // FormData
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE}${path}`, { method, headers, body: payload });
  } catch (e) {
    throw new ApiError("تعذّر الاتصال بالخادم — تحقّق من الشبكة", 0);
  }

  // تنزيل ملف
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new ApiError("فشل الطلب", res.status);
    return res; // المستدعي يتعامل مع الـ Response (blob)
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    if (res.status === 401) { Session.clear(); }
    throw new ApiError(data.error || "حدث خطأ", res.status, data);
  }
  return data;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const API = {
  // المصادقة
  setup: (b) => request("POST", "/api/setup", b),
  login: (b) => request("POST", "/api/auth/login", b),
  me: () => request("GET", "/api/auth/me"),
  changePassword: (b) => request("POST", "/api/auth/change-password", b),
  health: () => request("GET", "/api/health"),

  // المستخدمون
  listUsers: () => request("GET", "/api/users"),
  createUser: (b) => request("POST", "/api/users", b),
  updateUser: (id, b) => request("PUT", `/api/users/${id}`, b),
  deactivateUser: (id) => request("DELETE", `/api/users/${id}`),
  resetUserPassword: (id, b) => request("POST", `/api/users/${id}/reset-password`, b),

  // الموردون
  listSuppliers: () => request("GET", "/api/suppliers"),
  createSupplier: (b) => request("POST", "/api/suppliers", b),
  updateSupplier: (id, b) => request("PUT", `/api/suppliers/${id}`, b),
  deleteSupplier: (id) => request("DELETE", `/api/suppliers/${id}`),

  // العملاء
  listClients: () => request("GET", "/api/clients"),
  createClient: (b) => request("POST", "/api/clients", b),
  updateClient: (id, b) => request("PUT", `/api/clients/${id}`, b),
  deleteClient: (id) => request("DELETE", `/api/clients/${id}`),

  // الناقلون
  listCarriers: () => request("GET", "/api/carriers"),
  createCarrier: (b) => request("POST", "/api/carriers", b),
  updateCarrier: (id, b) => request("PUT", `/api/carriers/${id}`, b),
  deleteCarrier: (id) => request("DELETE", `/api/carriers/${id}`),

  // الغرامات
  listPenalties: () => request("GET", "/api/penalties"),
  createPenalty: (b) => request("POST", "/api/penalties", b),
  updatePenalty: (id, b) => request("PUT", `/api/penalties/${id}`, b),
  deletePenalty: (id) => request("DELETE", `/api/penalties/${id}`),

  // الشحنات
  listShipments: (qs = "") => request("GET", `/api/shipments${qs}`),
  getShipment: (id) => request("GET", `/api/shipments/${id}`),
  createShipment: (b) => request("POST", "/api/shipments", b),
  updateShipment: (id, b) => request("PUT", `/api/shipments/${id}`, b),
  changeStatus: (id, status) => request("POST", `/api/shipments/${id}/status`, { status }),
  deleteShipment: (id) => request("DELETE", `/api/shipments/${id}`),
  timeline: (id) => request("GET", `/api/shipments/${id}/timeline`),
  updateMilestones: (id, b) => request("PUT", `/api/shipments/${id}/milestones`, b),
  updateCargo: (id, b) => request("PUT", `/api/shipments/${id}/cargo`, b),
  updateReexport: (id, b) => request("PUT", `/api/shipments/${id}/reexport`, b),
  shipmentPenalties: (id) => request("GET", `/api/shipments/${id}/penalties`),

  // عمليات الكمارك (CD/LB)
  listCustomsOps: () => request("GET", "/api/customs-ops"),
  getCustomsOp: (id) => request("GET", `/api/customs-ops/${id}`),
  createCustomsOp: (b) => request("POST", "/api/customs-ops", b),
  updateCustomsOp: (id, b) => request("PUT", `/api/customs-ops/${id}`, b),
  deleteCustomsOp: (id) => request("DELETE", `/api/customs-ops/${id}`),
  listUpdates: (id) => request("GET", `/api/shipments/${id}/updates`),
  addUpdate: (id, b) => request("POST", `/api/shipments/${id}/updates`, b),
  alerts: () => request("GET", "/api/alerts"),

  // المستندات
  listDocuments: (id) => request("GET", `/api/shipments/${id}/documents`),
  uploadDocument: (id, formData) => request("POST", `/api/shipments/${id}/documents`, formData, true),
  addDocumentLink: (id, b) => request("POST", `/api/shipments/${id}/document-link`, b),
  downloadDocument: (id) => request("GET", `/api/documents/${id}/download`),
  deleteDocument: (id) => request("DELETE", `/api/documents/${id}`),

  // التعليقات
  listComments: (id) => request("GET", `/api/shipments/${id}/comments`),
  addComment: (id, body) => request("POST", `/api/shipments/${id}/comments`, { body }),

  // التخليص الكمركي
  saveCustoms: (id, b) => request("POST", `/api/shipments/${id}/customs`, b),
  customsQueue: () => request("GET", "/api/customs/queue"),

  // النقل
  listTransport: (id) => request("GET", `/api/shipments/${id}/transport`),
  createTransport: (id, b) => request("POST", `/api/shipments/${id}/transport`, b),
  updateTransport: (tid, b) => request("PUT", `/api/transport/${tid}`, b),
  deleteTransport: (tid) => request("DELETE", `/api/transport/${tid}`),
  transportQueue: () => request("GET", "/api/transport/queue"),

  // الحسابات
  listFinance: (id) => request("GET", `/api/shipments/${id}/finance`),
  createFinance: (id, b) => request("POST", `/api/shipments/${id}/finance`, b),
  updateFinance: (fid, b) => request("PUT", `/api/finance/${fid}`, b),
  deleteFinance: (fid) => request("DELETE", `/api/finance/${fid}`),
  financeOverview: () => request("GET", "/api/finance/overview"),

  // الإشعارات
  notifications: () => request("GET", "/api/notifications"),
  readNotification: (id) => request("POST", `/api/notifications/${id}/read`),
  readAllNotifications: () => request("POST", "/api/notifications/read-all"),

  // اللوحة والنشاط
  dashboard: () => request("GET", "/api/dashboard"),
  reports: () => request("GET", "/api/reports"),
  syncStatus: () => request("GET", "/api/sync/status"),
  syncChanges: (qs = "") => request("GET", `/api/sync/changes${qs}`),
  activity: (qs = "") => request("GET", `/api/activity${qs}`),
};
