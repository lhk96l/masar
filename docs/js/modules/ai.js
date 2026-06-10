/** وحدة المساعد الذكي (محادثة عربية فوق بيانات النظام) */
import { API } from "../api.js";
import { esc, statusBadge } from "../ui.js";

const SUGGESTIONS = [
  "ما المخاطر الحالية؟",
  "كم إجمالي الغرامات؟",
  "كم عدد الشحنات حسب الحالة؟",
  "أرني شحنات SCHLUMBERGER المتأخرة",
];

export function renderAI(root, app) {
  root.innerHTML = `
    <div class="page-head"><h1>🤖 المساعد الذكي</h1>
      <div class="head-meta"><span class="muted">اسأل بالعربية عن شحناتك وغراماتك ومخاطرك — إجابات من بياناتك الحقيقية</span></div></div>
    <div class="card ai-card">
      <div class="ai-messages" id="ai-msgs">
        <div class="ai-msg ai-bot">👋 أهلاً! اسألني مثل: «ما حالة شحنة Lot-B9-25-024؟» أو «كم إجمالي الغرامات؟»</div>
      </div>
      <div class="ai-suggest" id="ai-suggest">
        ${SUGGESTIONS.map((s) => `<button class="ai-chip">${esc(s)}</button>`).join("")}
      </div>
      <form class="ai-input" id="ai-form">
        <input type="text" id="ai-q" placeholder="اكتب سؤالك..." autocomplete="off">
        <button type="submit" class="btn btn-primary" id="ai-send">إرسال</button>
      </form>
    </div>`;

  const msgs = document.getElementById("ai-msgs");
  const input = document.getElementById("ai-q");
  const form = document.getElementById("ai-form");

  const add = (html, cls) => {
    const el = document.createElement("div");
    el.className = "ai-msg " + cls;
    el.innerHTML = html;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  };

  const ask = async (question) => {
    if (!question.trim()) return;
    add(esc(question), "ai-user");
    input.value = "";
    const thinking = add("<span class='ai-dots'>يفكّر...</span>", "ai-bot");
    try {
      const r = await API.aiAsk(question);
      let html = esc(r.answer || "—").replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      if (r.results && r.results.length) {
        html += `<div class="ai-results">${r.results.slice(0, 20).map((s) =>
          `<a class="ai-result" href="#/shipments/${s.id}"><strong>${esc(s.ref_no)}</strong> ${esc(s.title || "")} ${s.status ? statusBadge(s.status) : ""}</a>`).join("")}</div>`;
      }
      thinking.innerHTML = html;
    } catch (e) {
      thinking.innerHTML = "تعذّر الحصول على إجابة: " + esc(e.message);
    }
    msgs.scrollTop = msgs.scrollHeight;
  };

  form.onsubmit = (e) => { e.preventDefault(); ask(input.value); };
  document.querySelectorAll(".ai-chip").forEach((b) => b.onclick = () => ask(b.textContent));
  input.focus();
}
