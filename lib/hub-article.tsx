// ============================================================
// HubArticle — رندرکنندهٔ مشترک محتوای بلند صفحات SEO هاب
// (features / industries / taxes / compare / banks / cities /
//  case-studies / tutorials / ecosystem)
// ============================================================
// الگوی طراحی‌شده بر اساس الگوی اثبات‌شدهٔ مقالات بلاگ:
// - HTML محتوا از lib/hub-content/*.ts می‌آید (رشتهٔ HTML)
// - extractHeadingsWithIds به h2/h3 ها id می‌دهد و فهرست مطالب می‌سازد
// - کلاس blog-content استایل کامل جدول/blockquote/img دارد
// - FAQ با آکاردئون + CTA «شروع آزمایش رایگان ۱۴ روزه» به /pricing

import Link from "next/link";
import {
 Accordion,
 AccordionContent,
 AccordionItem,
 AccordionTrigger,
} from "@/components/ui/accordion";
import { TableOfContents } from "@/components/blog/table-of-contents";
import { extractHeadingsWithIds, type FaqItem } from "@/lib/seo";
import { CheckCircle2, ChevronLeft, HelpCircle, List, Package, Sparkles } from "lucide-react";

// ─── Task 23-J: جدول پلن‌های یکسان با pricing-view (یکدستی اطلاعات بین صفحات) ───
// اعداد از lib/plans.ts (پایه ۲/۴/۲,۴۰۰ — حرفه‌ای ۴/۶/۱۵,۰۰۰ — سازمانی نامحدود)
const HUB_PLAN_ROWS: { label: string; values: (string | boolean)[] }[] = [
 { label: "تعداد کاربران", values: ["۲", "۴", "نامحدود"] },
 { label: "تعداد انبار", values: ["۴", "۶", "نامحدود"] },
 { label: "فاکتور سالانه", values: ["۲,۴۰۰", "۱۵,۰۰۰", "نامحدود"] },
 { label: "اتصال به سامانه مودیان", values: [true, true, true] },
 { label: "هوش مصنوعی (OCR + دستیار)", values: [false, true, true] },
 { label: "حقوق و دستمزد", values: [false, true, true] },
 { label: "اتصال ووکامرس / دیجی‌کالا / باسلام", values: [false, false, true] },
 { label: "چند شرکتی (Multi-company)", values: [false, false, true] },
 { label: "پشتیبانی", values: ["ایمیلی", "اولویت‌دار", "اختصاصی ۲۴/۷"] },
];

export interface HubArticleProps {
 /** HTML کامل مقالهٔ بلند (بدون h1 — عنوان در خود صفحه است) */
 html: string;
 /** پرسش‌های متداول (۶+ مورد) — هم در UI و هم برای FAQPage schema استفاده می‌شود */
 faqs: FaqItem[];
 /** عنوان بخش FAQ */
 faqTitle?: string;
 /** متن CTA پایانی */
 ctaTitle?: string;
 ctaText?: string;
}

export function HubArticle({
 html,
 faqs,
 faqTitle = "پرسش‌های متداول",
 ctaTitle = "شروع آزمایش رایگان ۱۴ روزه هوش",
 ctaText = "بدون نیاز به کارت بانکی، بدون نصب و بدون تعهد — تمام ۱۶ ماژول هوش را ۱۴ روز کامل و رایگان امتحان کنید.",
}: HubArticleProps) {
 const { html: htmlWithIds, headings } = extractHeadingsWithIds(html);
 const hasToc = headings.length >= 3;

 return (
 <section aria-label="محتوای تخصصی" className="mt-12 sm:mt-16">
 {/* فهرست مطالب — جعبهٔ قابل مشاهده با لینک‌های لنگری */}
 {hasToc && (
 <nav
 aria-label="فهرست مطالب"
 className="mb-10 rounded-2xl border border-border bg-muted/30 p-5 sm:p-6"
 >
 <div className="flex items-center gap-2">
 <List className="h-4 w-4 text-primary" />
 <h2 className="text-base font-bold text-foreground">فهرست مطالب</h2>
 </div>
 <ol className="mt-4 grid gap-1.5 sm:grid-cols-2">
 {headings
 .filter((h) => h.level === 2)
 .map((h) => (
 <li key={h.id}>
 <a
 href={`#${h.id}`}
 className="text-sm leading-7 text-muted-foreground transition-colors hover:text-primary"
 >
 {h.text}
 </a>
 </li>
 ))}
 </ol>
 </nav>
 )}

 {/* بدنهٔ مقاله */}
 <article
 className="blog-content text-[15px] leading-8 text-foreground/90 sm:text-base sm:leading-9"
 dangerouslySetInnerHTML={{ __html: htmlWithIds }}
 />

 {/* پرسش‌های متداول */}
 <section aria-labelledby="hub-faq" className="mt-12">
 <div className="mb-5 flex items-center gap-2">
 <HelpCircle className="h-5 w-5 text-primary" />
 <h2 id="hub-faq" className="text-xl font-extrabold text-foreground sm:text-2xl">
 {faqTitle}
 </h2>
 </div>
 <Accordion type="single" collapsible className="w-full">
 {faqs.map((faq, idx) => (
 <AccordionItem key={idx} value={`hub-faq-${idx}`}>
 <AccordionTrigger className="text-right text-sm font-medium leading-relaxed sm:text-base">
 {faq.question}
 </AccordionTrigger>
 <AccordionContent className="text-sm leading-8 text-muted-foreground sm:text-base">
 {faq.answer}
 </AccordionContent>
 </AccordionItem>
 ))}
 </Accordion>
 </section>

 {/* ─── Task 23-J: جدول پلن‌ها — یکسان با صفحه قیمت‌گذاری (یکدستی اطلاعات) ─── */}
 <section aria-labelledby="hub-plans" className="mt-12">
 <div className="mb-5 flex items-center gap-2">
 <Package className="h-5 w-5 text-primary" />
 <h2 id="hub-plans" className="text-xl font-extrabold text-foreground sm:text-2xl">
 پلن‌های هوش در یک نگاه
 </h2>
 </div>
 <div className="overflow-x-auto rounded-2xl border border-border">
 <table className="w-full min-w-[560px] text-sm">
 <thead>
 <tr className="border-b border-border bg-muted/40 text-right">
 <th className="px-4 py-3 font-bold text-foreground">امکان</th>
 <th className="px-4 py-3 font-bold text-primary">پایه</th>
 <th className="px-4 py-3 font-bold text-primary">حرفه‌ای</th>
 <th className="px-4 py-3 font-bold text-primary">سازمانی</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {HUB_PLAN_ROWS.map((row) => (
 <tr key={row.label} className="text-right hover:bg-muted/20">
 <td className="px-4 py-2.5 font-medium text-foreground">{row.label}</td>
 {row.values.map((v, i) => (
 <td key={i} className="px-4 py-2.5 text-muted-foreground">
 {v === true ? (
 <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="دارد" />
 ) : v === false ? (
 <span className="text-muted-foreground/50">—</span>
 ) : (
 v
 )}
 </td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
 همین اعداد در <Link href="/pricing" prefetch={false} className="font-medium text-primary hover:underline">صفحه قیمت‌گذاری</Link>{' '}
 اعمال می‌شود و سوپرادمین می‌تواند محدودیت هر پلن را برای شما تنظیم کند. همه پلن‌ها ۱۴ روز آزمایش رایگان دارند.
 </p>
 </section>

 {/* CTA — شروع آزمایش رایگان ۱۴ روزه */}
 <div className="mt-12 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/10 to-primary/5 p-6 text-center sm:p-10">
 <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
 <Sparkles className="h-5 w-5" />
 </div>
 <h2 className="mt-4 text-xl font-extrabold text-foreground sm:text-2xl">{ctaTitle}</h2>
 <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
 {ctaText}
 </p>
 <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
 <Link
 href="/pricing"
 prefetch={false}
 className="inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90"
 >
 مشاهده پلن‌ها و شروع آزمایش رایگان ۱۴ روزه
 <ChevronLeft className="h-4 w-4" />
 </Link>
 <Link
 href="/"
 prefetch={false}
 className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-6 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
 >
 بازگشت به صفحه اصلی
 </Link>
 </div>
 </div>
 </section>
 );
}
