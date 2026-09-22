import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/platform-middleware";
import { rateLimitCheck, getClientIp } from "@/lib/rate-limit";
import { normalizePlanName, VALID_PLANS, getEffectiveLicenseDefaults } from "@/lib/plans";
import { toJalali, toPersianDigits } from "@/lib/persian";
import { sendEmail, isValidEmail } from "@/lib/email-sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============ Task 3-b — سوئیت عملیات کاربران (پنل سوپرادمین) ============
// GET  /api/platform/user-ops
//   ?section=users (پیش‌فرض) — لیست کاربران با فیلتر پیشرفته:
//       search | plan (free|basic|pro|enterprise) | status (active|blocked)
//       createdFrom/createdTo | lastLoginFrom/lastLoginTo (ISO)
//       hasLicense (true|false) | deleted (hide|only) | take (≤۵۰۰) | includeDemo
//   ?section=overdue — لیست پرداخت‌های معوق (فاکتور زندهٔ سررسیدگذشته با
//       ماندهٔ تسویه) + دنبال‌کردن خودکار (تنها هنگام بازدید همین تب —
//       بدون cron طبق قاعدهٔ مالک؛ همین رفتار در UI مستند است)
//   ?section=alerts — هشدارهای هوشمند افت استفاده (۳۰ روز اخیر در برابر
//       ۳۰ روز قبل آن — افت > ۵۰٪ = هشدار)
//
// POST /api/platform/user-ops
//   { action: "bulk", operation, userIds[], params }
//       operation: block | unblock | upgrade-plan | discount | soft-delete
//       block/unblock → User.isActive + وضعیت License (SUSPENDED/ACTIVE)
//       upgrade-plan → پلن tenant + لایسنس ACTIVE با سهمیه‌های مؤثر پلن
//       discount → تخفیف per-user (مدل License فیلد تخفیف ندارد → طبق
//         دستور مالک در SystemSettings کلید user_ops_discounts ذخیره و
//         در همین تب نمایش/اعمال مستند می‌شود)
//       soft-delete → deletedAt + غیرفعال + License SUSPENDED
//   { action: "overdue-toggle", invoiceId, auto } — روشن/خاموش دنبال‌کردن
//   { action: "overdue-remind", invoiceId } — ارسال یادآوری فوری
//       (پیام درون‌برنامه‌ای Notification برای گیرندهٔ tenant + ایمیل SMTP/mock)
//   { action: "winback-email", userIds[] } — ایمیل بازگشت کاربران کم‌فعال
//       + پیام درون‌برنامه‌ای (fallback همیشگی)
//
// همهٔ تغییرات در PlatformAuditLog ثبت می‌شوند (اکشن‌های USER_OPS_*).
// پیام درون‌برنامه‌ای «گیرندهٔ مشخص» از طریق مدل Notification می‌رود
// (tenantId+userId) — InAppMessage ابزار پیام گروهی targetRole/targetSegment
// است و گیرندهٔ فردی ندارد.

const MS_PER_DAY = 86_400_000;
/** حداکثر کاربر در هر عملیات گروهی — هم‌راستا با /api/platform/users */
const MAX_BULK_USERS = 200;
/** حداکثر ایمیل بازگشت در هر درخواست (با تأخیر ۱۰۰ms بین ارسال‌ها) */
const MAX_WINBACK = 50;
/** حداکثر یادآوری خودکار در هر بازدید تب معوق‌ها */
const MAX_AUTO_FOLLOWUPS_PER_VIEW = 25;
/** فاصلهٔ پیش‌فرض یادآوری خودکار (روز) */
const DEFAULT_FOLLOWUP_INTERVAL_DAYS = 7;
/** آستانهٔ هشدار افت استفاده (٪) */
const DROP_ALERT_THRESHOLD = 50;
/** حداقل رویداد دورهٔ قبل تا افت «معنادار» شمرده شود (کمتر از این نویز است) */
const MIN_PREV_ACTIVITY = 3;
/** فاصلهٔ امن بین ایمیل‌ها (میلی‌ثانیه) — فشار نیاورادن به SMTP */
const EMAIL_DELAY_MS = 100;

/** کلیدهای SystemSettings این ماژول */
const KEY_DISCOUNTS = "user_ops_discounts"; // map userId → { percent, appliedAt, appliedBy, note }
const KEY_FOLLOWUPS = "overdue_followups"; // map invoiceId → { auto, lastSent, intervalDays }

/** tenantهای غیردمو — همان قاعدهٔ saas-metrics/revenue-intelligence */
const NON_DEMO_TENANT_WHERE = {
 AND: [
  { OR: [{ subdomain: null }, { subdomain: { not: "demo" } }] },
  { name: { not: "سازمان دمو هوش" } },
 ],
};

/** نگاشت پلن UI → مقادیر واقعی Tenant.plan (starter=free قدیمی و ...) */
const PLAN_FILTER_MAP: Record<string, string[]> = {
 free: ["free", "starter"],
 basic: ["basic"],
 pro: ["pro", "business", "accountant"],
 enterprise: ["enterprise"],
};

const PLAN_FA: Record<string, string> = {
 free: "رایگان",
 basic: "پایه",
 pro: "حرفه‌ای",
 enterprise: "سازمانی",
};

const INVOICE_STATUS_FA: Record<string, string> = {
 PENDING: "در انتظار پرداخت",
 SENT: "ارسال‌شده",
 PARTIAL: "تسویه جزئی",
 PARTIALLY_PAID: "تسویه جزئی",
 OVERDUE: "سررسید گذشته",
};

/**
 * مطالبات /api/accounting/aging (هر دو واریانت PARTIAL و PARTIALLY_PAID
 * در کدبیس نوشته می‌شوند + PENDING)؛ DRAFT/RESERVED/PAID/CANCELLED بدهی نیست.
 */
const OVERDUE_STATUSES = ["PENDING", "SENT", "PARTIAL", "PARTIALLY_PAID", "OVERDUE"];

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
 return new Promise((resolve) => setTimeout(resolve, ms));
}

/** خواندن map JSON از SystemSettings — تحمل خطا با {} */
async function readSettingsMap(key: string): Promise<Record<string, unknown>> {
 try {
  const row = await db.systemSettings.findUnique({ where: { key } });
  if (!row?.value) return {};
  const parsed = JSON.parse(row.value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
 } catch {
  return {};
 }
}

/** نوشتن map JSON در SystemSettings (upsert) */
async function writeSettingsMap(key: string, value: Record<string, unknown>): Promise<void> {
 const serialized = JSON.stringify(value);
 await db.systemSettings.upsert({
  where: { key },
  update: { value: serialized },
  create: { key, value: serialized },
 });
}

/** escape امن HTML برای قالب ایمیل */
function escapeHtml(text: string): string {
 return text
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
}

/** قالب ایمیل RTL سبک — هم‌خانواده با send-email گروهی */
function buildEmailHtml(title: string, bodyText: string): string {
 const safeBody = escapeHtml(bodyText)
  .split("\n\n")
  .map((p) => `<p style="margin:0 0 14px 0;white-space:pre-line;">${p.replace(/\n/g, "<br/>")}</p>`)
  .join("");
 return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',tahoma,sans-serif;">
 <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(13,148,136,.10);">
  <div style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:20px 24px;">
   <div style="color:#ffffff;font-size:17px;font-weight:700;">${escapeHtml(title)}</div>
   <div style="color:#ccfbf1;font-size:12px;margin-top:4px;">هوش — حسابداری ابری</div>
  </div>
  <div style="padding:24px;color:#0f172a;font-size:14px;line-height:2;">${safeBody}</div>
  <div style="padding:14px 24px;background:#f1f5f9;color:#64748b;font-size:11px;text-align:center;">
   این پیام از سوی مدیریت هوش برای شما ارسال شده است.
  </div>
 </div>
</body>
</html>`;
}

interface RecipientCandidate {
 id: string;
 tenantId: string;
 name: string;
 email: string;
 role: string;
}

/** انتخاب گیرندهٔ tenant — اولویت ADMIN سپس اولین کاربر سالم */
function pickRecipient(users: RecipientCandidate[]): RecipientCandidate | null {
 if (users.length === 0) return null;
 return users.find((u) => u.role === "ADMIN") || users[0];
}

/** ارسال ایمیل + پیام درون‌برنامه‌ای — نتیجهٔ تحویل دو کانال */
async function deliverReminder(
 recipient: RecipientCandidate,
 subject: string,
 bodyText: string,
 notificationType: string
): Promise<{ inApp: boolean; email: { sent: boolean; mock: boolean; error?: string } }> {
 let inApp = false;
 try {
  await db.notification.create({
   data: {
    tenantId: recipient.tenantId,
    userId: recipient.id,
    title: subject,
    message: bodyText,
    type: notificationType,
    isRead: false,
   },
  });
  inApp = true;
 } catch {
  /* پیام درون‌برنامه‌ای اختیاری است — ایمیل ادامه می‌یابد */
 }
 let email = { sent: false, mock: false as boolean, error: undefined as string | undefined };
 if (recipient.email && isValidEmail(recipient.email)) {
  try {
   const result = await sendEmail({
    to: recipient.email,
    subject,
    html: buildEmailHtml(subject, bodyText),
    text: bodyText,
   });
   email = { sent: result.success, mock: Boolean(result.mock), error: result.error };
  } catch (err) {
   email = { sent: false, mock: false, error: err instanceof Error ? err.message : "خطای نامشخص" };
  }
 }
 return { inApp, email };
}

/** متن یادآوری پرداخت معوق — مبالغ تومان با ارقام فارسی */
function buildOverdueReminderText(params: {
 recipientName: string;
 invoiceNumber: string;
 remainingToman: string;
 daysOverdue: number;
 tenantName: string;
}): string {
 return [
  `${params.recipientName} عزیز،`,
  "",
  `فاکتور شمارهٔ ${params.invoiceNumber} سازمان «${params.tenantName}» ${toPersianDigits(params.daysOverdue)} روز از سررسید آن گذشته است و ماندهٔ تسویهٔ آن ${params.remainingToman} تومان است.`,
  "",
  "لطفاً برای جلوگیری از توقف خدمات، نسبت به تسویه این فاکتور اقدام فرمایید.",
  "",
  "با سپاس — تیم پشتیبانی هوش",
 ].join("\n");
}

/** متن ایمیل بازگشت (win-back) */
function buildWinbackText(recipientName: string): string {
 return [
  `${recipientName} عزیز،`,
  "",
  "مدتی است حضور گرم شما را در هوش ندیده‌ایم و دلتان برای ما تنگ شده است!",
  "حسابداری، انبار، صدور فاکتور و گزارش‌های شما همگی آمادهٔ ادامهٔ کار هستند — کافی است دوباره وارد شوید.",
  "",
  "اگر مشکلی پیش آمده یا کمکی لازم دارید، تیم پشتیبانی ما در کنار شماست؛ کافی است پاسخ همین ایمیل را بدهید.",
  "",
  "به بازگشت شما خوش آمدیم — تیم هوش",
 ].join("\n");
}

/** ثبت لاگ ممیزی پلتفرم — هرگز AuditLog با FK نامعتبر (قاعدهٔ SA-1) */
async function audit(
 adminId: string,
 action: string,
 entity: string,
 entityId: string | null,
 details: Record<string, unknown>,
 req: NextRequest
): Promise<void> {
 try {
  await db.platformAuditLog.create({
   data: {
    superAdminId: adminId,
    action,
    entity,
    entityId,
    details: JSON.stringify(details),
    ipAddress: req.headers.get("x-forwarded-for") || null,
   },
  });
 } catch {
  /* لاگ ممیزی هرگز جریان اصلی را نمی‌شکند */
 }
}

/** تبدیل ایمن BigInt ریال → عدد (مقیاس این مبالغ < ۲^۵۳) */
function toNumber(n: bigint): number {
 return Number(n);
}

// ----------------------------------------------------------------------------
// GET — سه بخش: users (پیش‌فرض) | overdue | alerts
// ----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 const rl = rateLimitCheck(`user-ops-get:${auth.admin.id}:${getClientIp(req)}`, 60, 60_000);
 if (!rl.ok) {
  return NextResponse.json({ success: false, error: "درخواست بیش از حد" }, { status: 429 });
 }

 const { searchParams } = new URL(req.url);
 const section = searchParams.get("section") || "users";

 try {
  if (section === "overdue") return await getOverdueSection();
  if (section === "alerts") return await getAlertsSection();
  return await getUsersSection(searchParams);
 } catch (error) {
  console.error("User-ops GET error:", error);
  return NextResponse.json({ success: false, error: "خطا در دریافت داده‌های عملیات کاربران" }, { status: 500 });
 }
}

// ----------------------------------------------------------------------------
// بخش ۱ — لیست کاربران با فیلتر پیشرفته
// ----------------------------------------------------------------------------
async function getUsersSection(searchParams: URLSearchParams) {
 const search = searchParams.get("search")?.trim() || "";
 const plan = searchParams.get("plan") || "all";
 const status = searchParams.get("status") || "all";
 const createdFrom = searchParams.get("createdFrom");
 const createdTo = searchParams.get("createdTo");
 const lastLoginFrom = searchParams.get("lastLoginFrom");
 const lastLoginTo = searchParams.get("lastLoginTo");
 const hasLicense = searchParams.get("hasLicense");
 const deleted = searchParams.get("deleted") || "hide";
 const includeDemo = searchParams.get("includeDemo") === "true";
 const take = Math.min(Number(searchParams.get("take") || "100") || 100, 500);

 const where: Record<string, unknown> = {};
 if (!includeDemo) where.isDemo = false;
 if (status === "active") where.isActive = true;
 if (status === "blocked") where.isActive = false;
 if (deleted === "hide") where.deletedAt = null;
 if (deleted === "only") where.deletedAt = { not: null };
 if (search) {
  where.OR = [
   { name: { contains: search } },
   { email: { contains: search } },
   { username: { contains: search } },
  ];
 }
 if (plan !== "all" && PLAN_FILTER_MAP[plan]) {
  where.tenant = { plan: { in: PLAN_FILTER_MAP[plan] } };
 }
 // بازهٔ تاریخ ایجاد
 const createdAt: Record<string, Date> = {};
 if (createdFrom) {
  const d = new Date(createdFrom);
  if (!isNaN(d.getTime())) createdAt.gte = d;
 }
 if (createdTo) {
  const d = new Date(createdTo);
  if (!isNaN(d.getTime())) {
   // «تا این تاریخ» شامل خود آن روز تا پایان روز باشد
   d.setHours(23, 59, 59, 999);
   createdAt.lte = d;
  }
 }
 if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
 // بازهٔ آخرین ورود (کاربرانی که هرگز وارد نشده‌اند در بازه قرار نمی‌گیرند)
 const lastLogin: Record<string, Date> = {};
 if (lastLoginFrom) {
  const d = new Date(lastLoginFrom);
  if (!isNaN(d.getTime())) lastLogin.gte = d;
 }
 if (lastLoginTo) {
  const d = new Date(lastLoginTo);
  if (!isNaN(d.getTime())) {
   d.setHours(23, 59, 59, 999);
   lastLogin.lte = d;
  }
 }
 if (Object.keys(lastLogin).length > 0) where.lastLogin = lastLogin;

 let users = await db.user.findMany({
  where,
  orderBy: { createdAt: "desc" },
  take,
  select: {
   id: true,
   username: true,
   email: true,
   name: true,
   role: true,
   isActive: true,
   isDemo: true,
   isTrial: true,
   lastLogin: true,
   createdAt: true,
   deletedAt: true,
   tenantId: true,
   tenant: { select: { id: true, name: true, plan: true, status: true } },
  },
 });

 // فیلتر «لایسنس دارد/ندارد» — tenantهایی که لایسنس متصل دارند
 if (hasLicense === "true" || hasLicense === "false") {
  const tenantIds = Array.from(new Set(users.map((u) => u.tenantId).filter(Boolean))) as string[];
  const withLicense = new Set<string>();
  if (tenantIds.length > 0) {
   const licenseRows = await db.license.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { tenantId: true },
   });
   for (const l of licenseRows) if (l.tenantId) withLicense.add(l.tenantId);
  }
  users = users.filter((u) =>
   hasLicense === "true" ? withLicense.has(u.tenantId || "") : !withLicense.has(u.tenantId || "")
  );
 }

 // لایسنس هر tenant (نمایش وضعیت/پایان) + تخفیف per-user + پیش‌نمایش کامنت
 const tenantIds = Array.from(new Set(users.map((u) => u.tenantId).filter(Boolean))) as string[];
 const [licenses, discountsRaw, comments] = await Promise.all([
  tenantIds.length > 0
   ? db.license.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { tenantId: true, plan: true, status: true, endDate: true },
      orderBy: { createdAt: "desc" },
     })
   : Promise.resolve([]),
  readSettingsMap(KEY_DISCOUNTS),
  tenantIds.length > 0
   ? db.tenantComment.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { tenantId: true, body: true, createdAt: true },
      orderBy: { createdAt: "desc" },
     })
   : Promise.resolve([]),
 ]);
 // جدیدترین لایسنس هر tenant
 const licenseByTenant = new Map<string, { plan: string; status: string; endDate: Date | null }>();
 for (const l of licenses) {
  if (l.tenantId && !licenseByTenant.has(l.tenantId)) {
   licenseByTenant.set(l.tenantId, { plan: l.plan, status: l.status, endDate: l.endDate });
  }
 }
 // شمار + آخرین کامنت هر tenant (پیش‌نمایش ردیف جدول کاربران)
 const commentByTenant = new Map<string, { count: number; latestPreview: string; latestAt: Date }>();
 for (const c of comments) {
  const existing = commentByTenant.get(c.tenantId);
  if (!existing) {
   commentByTenant.set(c.tenantId, {
    count: 1,
    latestPreview: c.body.slice(0, 60),
    latestAt: c.createdAt,
   });
  } else {
   existing.count += 1;
  }
 }

 const data = users.map((u) => {
  const discountEntry = discountsRaw[u.id] as { percent?: number } | undefined;
  const license = u.tenantId ? licenseByTenant.get(u.tenantId) || null : null;
  const comment = u.tenantId ? commentByTenant.get(u.tenantId) || null : null;
  const normalizedPlan = normalizePlanName(u.tenant?.plan);
  return {
   id: u.id,
   username: u.username,
   email: u.email,
   name: u.name,
   role: u.role,
   isActive: u.isActive,
   isDemo: u.isDemo,
   isTrial: u.isTrial,
   lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
   createdAt: u.createdAt.toISOString(),
   deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
   tenantId: u.tenantId,
   tenantName: u.tenant?.name || null,
   tenantPlan: u.tenant?.plan || null,
   planLabel: PLAN_FA[normalizedPlan] || normalizedPlan,
   license: license
    ? {
       status: license.status,
       plan: license.plan,
       endDate: license.endDate ? license.endDate.toISOString() : null,
      }
    : null,
   discountPercent: typeof discountEntry?.percent === "number" ? discountEntry.percent : null,
   tenantComment: comment
    ? { count: comment.count, latestPreview: comment.latestPreview, latestAt: comment.latestAt.toISOString() }
    : null,
  };
 });

 return NextResponse.json({
  success: true,
  data: {
   users: data,
   total: data.length,
   filters: { search, plan, status, hasLicense, deleted, includeDemo },
  },
 });
}

// ----------------------------------------------------------------------------
// بخش ۲ — لیست پرداخت‌های معوق + دنبال‌کردن خودکار هنگام بازدید
// ----------------------------------------------------------------------------
async function getOverdueSection() {
 const now = new Date();

 // فاکتورهای زندهٔ سررسیدگذشتهٔ «نهایی» (DRAFT/RESERVED بدهی نیست) در tenantهای غیردمو
 const invoices = await db.invoice.findMany({
  where: {
   deletedAt: null,
   status: { in: OVERDUE_STATUSES },
   dueDate: { not: null, lt: now },
   tenant: NON_DEMO_TENANT_WHERE,
  },
  select: {
   id: true,
   number: true,
   type: true,
   status: true,
   dueDate: true,
   paidAmount: true,
   total: true,
   tenantId: true,
   party: { select: { name: true } },
  },
  orderBy: { dueDate: "asc" },
  take: 200,
 });

 // فقط مانده‌دار (paidAmount < total)
 const overdue = invoices.filter((inv) => inv.paidAmount < inv.total);
 const tenantIds = Array.from(new Set(overdue.map((inv) => inv.tenantId)));
 const [tenants, recipientUsers, followupsRaw] = await Promise.all([
  tenantIds.length > 0
   ? db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
   : Promise.resolve([]),
  tenantIds.length > 0
   ? db.user.findMany({
      where: { tenantId: { in: tenantIds }, deletedAt: null, isActive: true, isDemo: false },
      select: { id: true, tenantId: true, name: true, email: true, role: true },
     })
   : Promise.resolve([]),
  readSettingsMap(KEY_FOLLOWUPS),
 ]);

 const tenantNames = new Map<string, string>(
  tenants.map((t): [string, string] => [t.id, t.name])
 );
 const usersByTenant = new Map<string, RecipientCandidate[]>();
 for (const u of recipientUsers) {
  const list = usersByTenant.get(u.tenantId) || [];
  list.push(u);
  usersByTenant.set(u.tenantId, list);
 }

 // ─── دنبال‌کردن خودکار — فقط هنگام بازدید همین تب (بدون cron) ───
 // برای فاکتورهای با auto=true که فاصلهٔ ارسال گذشته، یادآوری ارسال و
 // lastSent به‌روز می‌شود. (قاعدهٔ صریح مالک: cron ممنوع — ارسال خودکار
 // فقط روی بازدید تب انجام می‌شود و همین رفتار در UI مستند است.)
 const followups = followupsRaw as Record<string, { auto?: boolean; lastSent?: string; intervalDays?: number }>;
 let autoSent = 0;
 const autoSentInvoices: string[] = [];
 for (const inv of overdue) {
  const entry = followups[inv.id];
  if (!entry?.auto) continue;
  if (autoSent >= MAX_AUTO_FOLLOWUPS_PER_VIEW) break;
  const interval = (entry.intervalDays || DEFAULT_FOLLOWUP_INTERVAL_DAYS) * MS_PER_DAY;
  const lastSent = entry.lastSent ? new Date(entry.lastSent).getTime() : 0;
  if (now.getTime() - lastSent < interval) continue;
  const recipient = pickRecipient(usersByTenant.get(inv.tenantId) || []);
  if (!recipient) continue;
  const remainingRial = toNumber(inv.total) - toNumber(inv.paidAmount);
  const daysOverdue = Math.max(0, Math.floor((now.getTime() - (inv.dueDate as Date).getTime()) / MS_PER_DAY));
  const subject = `یادآوری پرداخت فاکتور ${inv.number}`;
  const text = buildOverdueReminderText({
   recipientName: recipient.name,
   invoiceNumber: inv.number,
   remainingToman: toPersianDigits(Math.round(remainingRial / 10).toLocaleString("fa-IR")),
   daysOverdue,
   tenantName: tenantNames.get(inv.tenantId) || "—",
  });
  try {
   await deliverReminder(recipient, subject, text, "WARNING");
   autoSent += 1;
   autoSentInvoices.push(inv.id);
   followups[inv.id] = { ...entry, auto: true, lastSent: now.toISOString() };
  } catch {
   /* خطای یک فاکتور مانع بقیه نمی‌شود */
  }
 }
 if (autoSent > 0) {
  await writeSettingsMap(KEY_FOLLOWUPS, followups);
 }

 const items = overdue.map((inv) => {
  const entry = followups[inv.id];
  const remainingRial = toNumber(inv.total) - toNumber(inv.paidAmount);
  const daysOverdue = Math.max(0, Math.floor((now.getTime() - (inv.dueDate as Date).getTime()) / MS_PER_DAY));
  const recipient = pickRecipient(usersByTenant.get(inv.tenantId) || []);
  return {
   invoiceId: inv.id,
   number: inv.number,
   type: inv.type,
   status: inv.status,
   statusLabel: INVOICE_STATUS_FA[inv.status] || inv.status,
   tenantId: inv.tenantId,
   tenantName: tenantNames.get(inv.tenantId) || "—",
   partyName: inv.party?.name || null,
   recipientUserId: recipient?.id || null,
   recipientName: recipient?.name || null,
   amountRemainingRial: remainingRial,
   amountRemainingToman: Math.round(remainingRial / 10),
   dueDate: (inv.dueDate as Date).toISOString(),
   dueDateJalali: toJalali(inv.dueDate as Date),
   daysOverdue,
   followup: {
    auto: Boolean(entry?.auto),
    lastSent: entry?.lastSent || null,
    intervalDays: entry?.intervalDays || DEFAULT_FOLLOWUP_INTERVAL_DAYS,
   },
  };
 });
 // مرتب‌سازی: دیرترین سررسید اول
 items.sort((a, b) => b.daysOverdue - a.daysOverdue);

 return NextResponse.json({
  success: true,
  data: {
   items,
   total: items.length,
   autoSent,
   autoSentInvoices,
   autoNote:
    "دنبال‌کردن خودکار فقط هنگام بازدید همین تب اجرا می‌شود (بدون cron) — برای فاکتورهای روشن‌شده هر ۷ روز یک یادآوری.",
  },
 });
}

// ----------------------------------------------------------------------------
// بخش ۳ — هشدارهای هوشمند افت استفاده
// ----------------------------------------------------------------------------
async function getAlertsSection() {
 const now = new Date();
 const t30 = new Date(now.getTime() - 30 * MS_PER_DAY);
 const t60 = new Date(now.getTime() - 60 * MS_PER_DAY);

 const [users, audits, invoices] = await Promise.all([
  db.user.findMany({
   where: { deletedAt: null, isDemo: false, tenant: NON_DEMO_TENANT_WHERE },
   select: {
    id: true,
    name: true,
    email: true,
    role: true,
    lastLogin: true,
    tenantId: true,
    tenant: { select: { name: true, plan: true } },
   },
   take: 500,
  }),
  db.auditLog.findMany({
   where: { createdAt: { gte: t60 } },
   select: { userId: true, tenantId: true, createdAt: true },
  }),
  db.invoice.findMany({
   where: { createdAt: { gte: t60 }, deletedAt: null, tenant: NON_DEMO_TENANT_WHERE },
   select: { tenantId: true, createdAt: true },
  }),
 ]);

 // شمارش رویداد هر کاربر در دو پنجره + آخرین فعالیت
 const eventsByUser = new Map<string, { last: number; prev: number; lastAt: Date | null }>();
 for (const a of audits) {
  if (!a.userId) continue;
  const entry = eventsByUser.get(a.userId) || { last: 0, prev: 0, lastAt: null };
  if (a.createdAt >= t30) entry.last += 1;
  else entry.prev += 1;
  if (!entry.lastAt || a.createdAt > entry.lastAt) entry.lastAt = a.createdAt;
  eventsByUser.set(a.userId, entry);
 }
 // شمارش فاکتور هر tenant در دو پنجره
 const invoicesByTenant = new Map<string, { last: number; prev: number }>();
 for (const inv of invoices) {
  const entry = invoicesByTenant.get(inv.tenantId) || { last: 0, prev: 0 };
  if (inv.createdAt >= t30) entry.last += 1;
  else entry.prev += 1;
  invoicesByTenant.set(inv.tenantId, entry);
 }

 const items: Array<Record<string, unknown>> = [];
 for (const u of users) {
  const events = eventsByUser.get(u.id) || { last: 0, prev: 0, lastAt: null };
  const inv = u.tenantId ? invoicesByTenant.get(u.tenantId) || { last: 0, prev: 0 } : { last: 0, prev: 0 };
  const activityLast = events.last + inv.last;
  const activityPrev = events.prev + inv.prev;
  // بدون سابقهٔ کافی → افت قابل‌قضاوت نیست (نویز)
  if (activityPrev < MIN_PREV_ACTIVITY) continue;
  const ratio = activityPrev > 0 ? activityLast / activityPrev : 1;
  const dropPercent = Math.round((1 - ratio) * 100);
  if (dropPercent <= DROP_ALERT_THRESHOLD) continue;
  const lastActiveCandidates = [u.lastLogin, events.lastAt].filter(Boolean) as Date[];
  const lastActive =
   lastActiveCandidates.length > 0 ? new Date(Math.max(...lastActiveCandidates.map((d) => d.getTime()))) : null;
  const normalizedPlan = normalizePlanName(u.tenant?.plan);
  items.push({
   userId: u.id,
   name: u.name,
   email: u.email,
   role: u.role,
   tenantId: u.tenantId,
   tenantName: u.tenant?.name || "—",
   planLabel: PLAN_FA[normalizedPlan] || normalizedPlan,
   dropPercent,
   activityLast,
   activityPrev,
   eventsLast30: events.last,
   eventsPrev30: events.prev,
   invoicesLast30: inv.last,
   invoicesPrev30: inv.prev,
   lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
   lastActive: lastActive ? lastActive.toISOString() : null,
   lastActiveJalali: lastActive ? toJalali(lastActive) : null,
  });
 }
 // بیشترین افت اول + سقف ۱۰۰ ردیف
 items.sort((a, b) => (b.dropPercent as number) - (a.dropPercent as number));

 return NextResponse.json({
  success: true,
  data: {
   items: items.slice(0, 100),
   total: items.length,
   windowDays: 30,
   thresholdPercent: DROP_ALERT_THRESHOLD,
   note: "مقایسهٔ ۳۰ روز اخیر با ۳۰ روز قبل آن — افت بیش از ۵۰٪ فعالیت (رویداد + فاکتور) هشدار است.",
  },
 });
}

// ----------------------------------------------------------------------------
// POST — عملیات گروهی + دنبال‌کردن + یادآوری + ایمیل بازگشت
// ----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 const rl = rateLimitCheck(`user-ops-post:${auth.admin.id}:${getClientIp(req)}`, 20, 60_000);
 if (!rl.ok) {
  return NextResponse.json({ success: false, error: "درخواست بیش از حد" }, { status: 429 });
 }

 try {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");

  if (action === "bulk") return await postBulk(body, auth.admin, req);
  if (action === "overdue-toggle") return await postOverdueToggle(body, auth.admin, req);
  if (action === "overdue-remind") return await postOverdueRemind(body, auth.admin, req);
  if (action === "winback-email") return await postWinback(body, auth.admin, req);

  return NextResponse.json({ success: false, error: "اکشن نامعتبر" }, { status: 400 });
 } catch (error) {
  console.error("User-ops POST error:", error);
  return NextResponse.json({ success: false, error: "خطا در انجام عملیات" }, { status: 500 });
 }
}

/** عملیات گروهی روی کاربران — همه با تأیید شمار در UI فراخوانی می‌شود */
async function postBulk(
 body: Record<string, unknown>,
 admin: { id: string; username: string },
 req: NextRequest
) {
 const operation = String(body?.operation || "");
 const userIds = Array.isArray(body?.userIds) ? (body.userIds as unknown[]).map(String).filter(Boolean) : [];
 const params = (body?.params || {}) as { plan?: string; percent?: number; note?: string };

 const VALID_OPS = ["block", "unblock", "upgrade-plan", "discount", "soft-delete"];
 if (!VALID_OPS.includes(operation)) {
  return NextResponse.json({ success: false, error: "عملیات گروهی نامعتبر" }, { status: 400 });
 }
 if (userIds.length === 0) {
  return NextResponse.json({ success: false, error: "هیچ کاربری انتخاب نشده است" }, { status: 400 });
 }
 if (userIds.length > MAX_BULK_USERS) {
  return NextResponse.json(
   { success: false, error: `حداکثر ${toPersianDigits(MAX_BULK_USERS)} کاربر در هر عملیات گروهی` },
   { status: 400 }
  );
 }

 // کاربران موجود + tenantهای درگیر
 const users = await db.user.findMany({
  where: { id: { in: userIds } },
  select: { id: true, tenantId: true, isActive: true },
 });
 if (users.length === 0) {
  return NextResponse.json({ success: false, error: "کاربران یافت نشدند" }, { status: 404 });
 }
 const existingIds = users.map((u) => u.id);
 const tenantIds = Array.from(new Set(users.map((u) => u.tenantId).filter(Boolean))) as string[];
 let affected = 0;
 let message = "";

 if (operation === "block") {
  const res = await db.user.updateMany({
   where: { id: { in: existingIds } },
   data: { isActive: false },
  });
  if (tenantIds.length > 0) {
   await db.license.updateMany({ where: { tenantId: { in: tenantIds } }, data: { status: "SUSPENDED" } });
  }
  affected = res.count;
  message = `${toPersianDigits(affected)} کاربر مسدود و لایسنس سازمان‌هایشان معلق شد`;
 } else if (operation === "unblock") {
  const res = await db.user.updateMany({
   where: { id: { in: existingIds } },
   data: { isActive: true, deletedAt: null },
  });
  if (tenantIds.length > 0) {
   // فقط لایسنس‌های «معلق» فعال می‌شوند — EXPIRED/REVOKED دست‌نخورده می‌مانند
   await db.license.updateMany({
    where: { tenantId: { in: tenantIds }, status: "SUSPENDED" },
    data: { status: "ACTIVE" },
   });
  }
  affected = res.count;
  message = `${toPersianDigits(affected)} کاربر فعال شد (و رفع حذف نرم)`;
 } else if (operation === "upgrade-plan") {
  const plan = normalizePlanName(String(params?.plan || ""));
  if (!VALID_PLANS.includes(plan)) {
   return NextResponse.json({ success: false, error: "پلن نامعتبر است" }, { status: 400 });
  }
  // سهمیه‌های مؤثر پلن (قابل‌ویرایش سوپرادمین در محدودیت پلن‌ها)
  const newDefaults = await getEffectiveLicenseDefaults(plan);
  const distinctTenants = Array.from(new Set(tenantIds));
  for (const tenantId of distinctTenants) {
   await db.tenant.update({ where: { id: tenantId }, data: { plan } });
   await db.license.updateMany({
    where: { tenantId, status: "ACTIVE" },
    data: {
     plan,
     maxUsers: newDefaults.maxUsers,
     maxInvoices: newDefaults.maxInvoices,
     maxWarehouses: newDefaults.maxWarehouses,
     features: JSON.stringify(newDefaults.features),
    },
   });
  }
  affected = existingIds.length;
  message = `پلن ${toPersianDigits(distinctTenants.length)} سازمان به «${PLAN_FA[plan] || plan}» ارتقا یافت (${toPersianDigits(affected)} کاربر)`;
 } else if (operation === "discount") {
  // License فیلد تخفیف ندارد → override per-user در SystemSettings
  // (مستند در UI) — { userId: { percent, appliedAt, appliedBy, note } }
  const percent = Math.round(Number(params?.percent));
  if (!Number.isFinite(percent) || percent < 1 || percent > 99) {
   return NextResponse.json({ success: false, error: "درصد تخفیف باید بین ۱ تا ۹۹ باشد" }, { status: 400 });
  }
  const discounts = await readSettingsMap(KEY_DISCOUNTS);
  const note = typeof params?.note === "string" ? params.note.slice(0, 200) : undefined;
  for (const id of existingIds) {
   discounts[id] = { percent, appliedAt: new Date().toISOString(), appliedBy: admin.id, note };
  }
  await writeSettingsMap(KEY_DISCOUNTS, discounts);
  affected = existingIds.length;
  message = `تخفیف ${toPersianDigits(percent)}٪ برای ${toPersianDigits(affected)} کاربر ثبت شد`;
 } else if (operation === "soft-delete") {
  const res = await db.user.updateMany({
   where: { id: { in: existingIds } },
   data: { deletedAt: new Date(), isActive: false },
  });
  if (tenantIds.length > 0) {
   await db.license.updateMany({ where: { tenantId: { in: tenantIds } }, data: { status: "SUSPENDED" } });
  }
  affected = res.count;
  message = `${toPersianDigits(affected)} کاربر حذف نرم شد (قابل بازگردانی با «رفع مسدودسازی»)`;
 }

 await audit(
  admin.id,
  `USER_OPS_BULK_${operation.replace(/-/g, "_").toUpperCase()}`,
  "User",
  null,
  { operation, userIds: existingIds, count: affected, params: params || {} },
  req
 );

 return NextResponse.json({ success: true, affected, message });
}

/** روشن/خاموش دنبال‌کردن خودکار یک فاکتور معوق */
async function postOverdueToggle(body: Record<string, unknown>, admin: { id: string }, req: NextRequest) {
 const invoiceId = String(body?.invoiceId || "");
 const auto = Boolean(body?.auto);
 if (!invoiceId) {
  return NextResponse.json({ success: false, error: "شناسه فاکتور الزامی است" }, { status: 400 });
 }
 const invoice = await db.invoice.findUnique({
  where: { id: invoiceId },
  select: { id: true, number: true, tenantId: true },
 });
 if (!invoice) {
  return NextResponse.json({ success: false, error: "فاکتور یافت نشد" }, { status: 404 });
 }
 const followups = (await readSettingsMap(KEY_FOLLOWUPS)) as Record<
  string,
  { auto?: boolean; lastSent?: string; intervalDays?: number }
 >;
 const existing = followups[invoiceId] || {};
 followups[invoiceId] = {
  ...existing,
  auto,
  intervalDays: existing.intervalDays || DEFAULT_FOLLOWUP_INTERVAL_DAYS,
 };
 await writeSettingsMap(KEY_FOLLOWUPS, followups);
 await audit(admin.id, "USER_OPS_OVERDUE_TOGGLE", "Invoice", invoiceId, { invoiceId, number: invoice.number, auto }, req);
 return NextResponse.json({
  success: true,
  data: { invoiceId, auto },
  message: auto ? "دنبال‌کردن خودکار روشن شد (ارسال هنگام بازدید تب)" : "دنبال‌کردن خودکار خاموش شد",
 });
}

/** ارسال فوری یادآوری پرداخت — پیام درون‌برنامه‌ای + ایمیل */
async function postOverdueRemind(body: Record<string, unknown>, admin: { id: string }, req: NextRequest) {
 const invoiceId = String(body?.invoiceId || "");
 if (!invoiceId) {
  return NextResponse.json({ success: false, error: "شناسه فاکتور الزامی است" }, { status: 400 });
 }
 const invoice = await db.invoice.findUnique({
  where: { id: invoiceId },
  select: {
   id: true,
   number: true,
   status: true,
   dueDate: true,
   paidAmount: true,
   total: true,
   tenantId: true,
   tenant: { select: { id: true, name: true } },
  },
 });
 if (!invoice) {
  return NextResponse.json({ success: false, error: "فاکتور یافت نشد" }, { status: 404 });
 }
 // گیرنده — ADMIN سازمان در اولویت
 const candidates = await db.user.findMany({
  where: { tenantId: invoice.tenantId, deletedAt: null, isActive: true, isDemo: false },
  select: { id: true, tenantId: true, name: true, email: true, role: true },
 });
 const recipient = pickRecipient(candidates);
 if (!recipient) {
  return NextResponse.json(
   { success: false, error: "کاربر فعالی برای دریافت یادآوری در این سازمان یافت نشد" },
   { status: 400 }
  );
 }
 const now = new Date();
 const remainingRial = toNumber(invoice.total) - toNumber(invoice.paidAmount);
 const daysOverdue = invoice.dueDate
  ? Math.max(0, Math.floor((now.getTime() - invoice.dueDate.getTime()) / MS_PER_DAY))
  : 0;
 const subject = `یادآوری پرداخت فاکتور ${invoice.number}`;
 const text = buildOverdueReminderText({
  recipientName: recipient.name,
  invoiceNumber: invoice.number,
  remainingToman: toPersianDigits(Math.round(remainingRial / 10).toLocaleString("fa-IR")),
  daysOverdue,
  tenantName: invoice.tenant?.name || "—",
 });
 const delivery = await deliverReminder(recipient, subject, text, "WARNING");

 // به‌روزرسانی lastSent دنبال‌کردن
 const followups = (await readSettingsMap(KEY_FOLLOWUPS)) as Record<
  string,
  { auto?: boolean; lastSent?: string; intervalDays?: number }
 >;
 const existing = followups[invoiceId] || {};
 followups[invoiceId] = { ...existing, lastSent: now.toISOString() };
 await writeSettingsMap(KEY_FOLLOWUPS, followups);

 await audit(
  admin.id,
  "USER_OPS_OVERDUE_REMIND",
  "Invoice",
  invoiceId,
  {
   invoiceId,
   number: invoice.number,
   tenantName: invoice.tenant?.name,
   recipient: recipient.name,
   inApp: delivery.inApp,
   emailSent: delivery.email.sent,
   emailMock: delivery.email.mock,
  },
  req
 );

 return NextResponse.json({
  success: true,
  data: { invoiceId, ...delivery, recipientName: recipient.name },
  message: delivery.email.sent
   ? `یادآوری برای ${recipient.name} ارسال شد (پیام درون‌برنامه‌ای${delivery.email.mock ? " + ایمیل آزمایشی" : " + ایمیل"})`
   : `پیام درون‌برنامه‌ای برای ${recipient.name} ارسال شد (ایمیل ارسال نشد: ${delivery.email.error || "آدرس نامعتبر"})`,
 });
}

/** ایمیل بازگشت کاربران کم‌فعال + پیام درون‌برنامه‌ای */
async function postWinback(body: Record<string, unknown>, admin: { id: string }, req: NextRequest) {
 const userIds = Array.isArray(body?.userIds) ? (body.userIds as unknown[]).map(String).filter(Boolean) : [];
 if (userIds.length === 0) {
  return NextResponse.json({ success: false, error: "هیچ کاربری انتخاب نشده است" }, { status: 400 });
 }
 if (userIds.length > MAX_WINBACK) {
  return NextResponse.json(
   { success: false, error: `حداکثر ${toPersianDigits(MAX_WINBACK)} کاربر در هر ارسال ایمیل بازگشت` },
   { status: 400 }
  );
 }
 const users = await db.user.findMany({
  where: { id: { in: userIds }, deletedAt: null },
  select: { id: true, tenantId: true, name: true, email: true, role: true },
 });
 if (users.length === 0) {
  return NextResponse.json({ success: false, error: "کاربران یافت نشدند" }, { status: 404 });
 }

 const subject = "دلتان برای ما تنگ شده؟";
 let sent = 0;
 let failed = 0;
 let mockCount = 0;
 let inAppCount = 0;
 for (let i = 0; i < users.length; i++) {
  if (i > 0) await sleep(EMAIL_DELAY_MS);
  const u = users[i];
  const text = buildWinbackText(u.name);
  const recipient: RecipientCandidate = {
   id: u.id,
   tenantId: u.tenantId,
   name: u.name,
   email: u.email,
   role: u.role,
  };
  try {
   const delivery = await deliverReminder(recipient, subject, text, "INFO");
   if (delivery.inApp) inAppCount += 1;
   if (delivery.email.sent) {
    sent += 1;
    if (delivery.email.mock) mockCount += 1;
   } else {
    failed += 1;
   }
  } catch {
   failed += 1;
  }
 }

 await audit(
  admin.id,
  "USER_OPS_WINBACK_EMAIL",
  "User",
  null,
  { userIds: users.map((u) => u.id), sent, failed, mock: mockCount, inApp: inAppCount },
  req
 );

 return NextResponse.json({
  success: true,
  data: { total: users.length, sent, failed, mock: mockCount, inApp: inAppCount },
  message:
   failed === 0
    ? `ایمیل بازگشت برای ${toPersianDigits(sent)} کاربر ارسال شد${mockCount > 0 ? " (SMTP تنظیم نیست — حالت آزمایشی)" : ""} + ${toPersianDigits(inAppCount)} پیام درون‌برنامه‌ای`
    : `ارسال کامل نشد — ${toPersianDigits(sent)} موفق، ${toPersianDigits(failed)} ناموفق (${toPersianDigits(inAppCount)} پیام درون‌برنامه‌ای)`,
 });
}
