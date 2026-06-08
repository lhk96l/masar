/**
 * MASAR — نسخة احتياطية كاملة لقاعدة بيانات D1
 * الاستخدام:  npm run db:backup
 * تُصدَّر القاعدة كاملة إلى ملف SQL مؤرّخ داخل مجلد backups/ (غير مرفوع للريبو).
 * هذه طبقة حماية ثالثة فوق متانة Cloudflare و«السفر عبر الزمن» (30 يوماً).
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "backups");
fs.mkdirSync(dir, { recursive: true });

const ts = new Date().toISOString().replace(/:/g, "").replace(/\..+/, "").replace("T", "-");
const out = path.join(dir, `masar-backup-${ts}.sql`);

console.log("⏳ جارٍ تصدير قاعدة البيانات masar-db ...");
try {
  execSync(`npx wrangler d1 export masar-db --remote --output "${out}"`, { stdio: "inherit" });
  const size = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`\n✅ تمت النسخة الاحتياطية: ${out} (${size} KB)`);
} catch (e) {
  console.error("\n❌ فشل التصدير:", e.message);
  process.exit(1);
}
