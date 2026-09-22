"use client";

/**
 * theme-registry — رجیستری ۱۴ تم خیره‌کنندهٔ «هوش» (v13.1)
 *
 * هر تم = یک پالت کامل ۳۳-متغیره (روشن/تاریک) که «کل» برنامه را
 * دگرگون می‌کند: پس‌زمینهٔ ته‌رنگ‌دار، کارت‌ها، سایدبار، نمودارها،
 * دکمه‌ها و رینگ فوکوس — نه فقط تعویض یک رنگ!
 *
 * تعریف رنگ‌ها فقط و فقط در app/globals.css است (بلوک‌های
 * [data-theme="x"] و .dark[data-theme="x"]). این فایل فقط متادیتا،
 * آیکون‌ست و سازوکار اعمال را نگه می‌دارد؛ پیش‌نمایش زندهٔ کارت‌ها
 * در ThemePicker با ایزوله‌کردن data-theme روی همان کارت انجام
 * می‌شود — یعنی همیشه با رنگ واقعی تم، بدون تکرار داده.
 *
 * روان‌شناسی رنگ (مرجع انتخاب پالت‌ها):
 * - بنفش: تیزبینی، خرد، خلاقیت — معنای «هوش» (تم پرچمدار)
 * - فیروزه/سبز: اعتماد، آرامش، رشد و پول
 * - لاجورد: اقتدار و اعتماد عمیق
 * - نارنجی/کهربا: انرژی، گرمی، خوش‌بینی
 * - سرخ/صورتی: عاطفه، صمیمیت، شور
 * - خاکستری: تمرکز مطلق و مینیمالیسم
 *
 * سازوکار اعمال:
 * - انتخاب کاربر در localStorage (کلید hoosh_theme) ذخیره می‌شود.
 * - روی <html> ویژگی data-theme="{id}" نوشته می‌شود.
 * - حالت روشن/تاریک (class="dark" از next-themes) کاملاً جدا و
 *   مستقل از تم رنگی است.
 *
 * آیکون‌ها:
 * - iconSet هر تم برای کلیدهای ماژول (dashboard، invoices، wallet و...)
 *   نام آیکون lucide مخصوص همان شخصیت تم را می‌دهد.
 * - useThemeIcon(moduleId, fallback) در سایدبار استفاده می‌شود.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  // بنفشهٔ سلطنتی (پرچمدار)
  Crown,
  Scroll,
  WandSparkles,
  Layers,
  Gem,
  UsersRound,
  Orbit,
  Rocket,
  Presentation,
  Medal,
  // شفق قطبی
  Telescope,
  ReceiptText,
  Wind,
  Snowflake,
  Droplets,
  Anchor,
  Sparkle,
  Sailboat,
  ChartNoAxesColumn,
  Rainbow,
  // زمرد
  LayoutDashboard,
  ShoppingCart,
  Zap,
  Package,
  Wallet,
  Heart,
  Sparkles,
  MonitorSmartphone,
  FileBarChart,
  Users,
  // فیروزه ایرانی
  Waves,
  ScrollText,
  Feather,
  Boxes,
  PiggyBank,
  Handshake,
  Brain,
  Store,
  LineChart,
  Share2,
  // لاجورد
  Atom,
  ChartColumn,
  Infinity,
  Banknote,
  Monitor,
  // کهربای طلایی
  Sun,
  FileText,
  Flame,
  Box,
  Coins,
  Smile,
  Lightbulb,
  Barcode,
  TrendingUp,
  Star,
  // مرجان
  Sunrise,
  Receipt,
  Send,
  Container,
  CreditCard,
  HeartHandshake,
  Wand2,
  Smartphone,
  PieChart,
  UserPlus,
  // غروب
  Sunset,
  MoonStar,
  ChartPie,
  // گل‌سرخ
  Flower2,
  Mail,
  PenLine,
  ShoppingBag,
  HandCoins,
  HandHeart,
  ScanLine,
  Activity,
  Gift,
  // رزگلد
  Shell,
  // کهکشان
  ChartSpline,
  Eclipse,
  // جنگل
  Mountain,
  BookOpen,
  Bolt,
  Trees,
  Landmark,
  Contact,
  Microscope,
  Warehouse,
  ClipboardList,
  Sprout,
  // سفال ایرانی
  Home,
  NotebookPen,
  Pencil,
  Package2,
  Phone,
  Compass,
  HandPlatter,
  NotebookText,
  Link2,
  // گرافیت
  LayoutGrid,
  File,
  Plus,
  Archive,
  CircleDollarSign,
  User,
  Cpu,
  BarChart3,
  Link,
} from "lucide-react";

/* ============================================================
 * انواع داده
 * ============================================================ */

/** دستهٔ مود تم (برای فیلتر انتخابگر تم) */
export type ThemeCategory = "flagship" | "trust" | "energy" | "emotion" | "minimal";

export interface AppTheme {
  id: string;
  /** نام فارسی تم */
  nameFa: string;
  /** یک‌خطی معرفی */
  tagline: string;
  /** توضیح روان‌شناسی رنگ — چرا این تم این حس را می‌دهد */
  psychology: string;
  /** دستهٔ مود */
  category: ThemeCategory;
  /** آیکون lucide هر ماژول بر اساس شخصیت تم */
  iconSet: Record<string, string>;
}

/** کلیدهای ماژول که آیکونشان با تم عوض می‌شود */
export type ThemeModuleId =
  | "dashboard"
  | "invoices"
  | "quick-invoice"
  | "inventory"
  | "wallet"
  | "crm"
  | "ai"
  | "pos"
  | "reports-builder"
  | "referral";

/** برچسب فارسی دسته‌ها — برای UI انتخابگر */
export const THEME_CATEGORIES: { id: ThemeCategory | "all"; label: string }[] = [
  { id: "all", label: "همهٔ تم‌ها" },
  { id: "flagship", label: "پیشنهاد هوش" },
  { id: "trust", label: "اعتماد و آرامش" },
  { id: "energy", label: "انرژی و گرمی" },
  { id: "emotion", label: "عاطفه و لوکس" },
  { id: "minimal", label: "حرفه‌ای و مینیمال" },
];

/* ============================================================
 * رجیستری ۱۴ تم — پالت‌ها در globals.css تعریف شده‌اند
 * ============================================================ */

export const THEMES: AppTheme[] = [
  {
    id: "violet",
    nameFa: "بنفشهٔ سلطنتی",
    tagline: "هوش، خرد و شکوه — تم پرچمدار هوش",
    psychology:
      "بنفش در روان‌شناسی رنگ نماد تیزبینی، خرد و خلاقیت است؛ دقیقاً همان معنای «هوش». فوشیای مکمل، جرقهٔ انرژی می‌افروزد و پس‌زمینهٔ ته‌رنگ‌دار بنفش، خستگی چشم را در ساعت‌های طولانی کار کم می‌کند. انتخاب برندهای موفق فین‌تک.",
    category: "flagship",
    iconSet: {
      dashboard: "Crown",
      invoices: "Scroll",
      "quick-invoice": "WandSparkles",
      inventory: "Layers",
      wallet: "Gem",
      crm: "UsersRound",
      ai: "Orbit",
      pos: "Rocket",
      "reports-builder": "Presentation",
      referral: "Medal",
    },
  },
  {
    id: "aurora",
    nameFa: "شفق قطبی",
    tagline: "آرامش فیروزه‌ای با پرتوهای بنفش قطبی",
    psychology:
      "ترکیب فیروزه و بنفش مثل شفق قطبی: آرامش و تعادل برای ساعت‌های طولانی کار، همراه با الهام‌بخشیِ رگهٔ بنفش. ذهن را خنک و متمرکز نگه می‌دارد.",
    category: "trust",
    iconSet: {
      dashboard: "Telescope",
      invoices: "ReceiptText",
      "quick-invoice": "Wind",
      inventory: "Snowflake",
      wallet: "Droplets",
      crm: "Anchor",
      ai: "Sparkle",
      pos: "Sailboat",
      "reports-builder": "ChartNoAxesColumn",
      referral: "Rainbow",
    },
  },
  {
    id: "emerald",
    nameFa: "زمرد",
    tagline: "اعتماد، رشد و برکتِ سبز زمرد",
    psychology:
      "سبز زمردی نماد رشد، پول و برکت است؛ برای حسابداری و انبار، حس اعتماد و ثبات مالی می‌سازد. کهربای مکمل، زنگ خطر و نکتهٔ طلایی را متمایز می‌کند.",
    category: "trust",
    iconSet: {
      dashboard: "LayoutDashboard",
      invoices: "ShoppingCart",
      "quick-invoice": "Zap",
      inventory: "Package",
      wallet: "Wallet",
      crm: "Heart",
      ai: "Sparkles",
      pos: "MonitorSmartphone",
      "reports-builder": "FileBarChart",
      referral: "Users",
    },
  },
  {
    id: "teal",
    nameFa: "فیروزه ایرانی",
    tagline: "آرامش و تمرکز با اصالت سنگ فیروزه",
    psychology:
      "فیروزه، سنگ اصیل ایرانی؛ رنگی که ذهن را آرام و تمرکز را بالا می‌برد. طلای مکمل آن، حس ارزش و اهمیت دادن به امور مالی می‌بخشد.",
    category: "trust",
    iconSet: {
      dashboard: "Waves",
      invoices: "ScrollText",
      "quick-invoice": "Feather",
      inventory: "Boxes",
      wallet: "PiggyBank",
      crm: "Handshake",
      ai: "Brain",
      pos: "Store",
      "reports-builder": "LineChart",
      referral: "Share2",
    },
  },
  {
    id: "lapis",
    nameFa: "لاجورد",
    tagline: "اقتدار لاجورد ایرانی با رگه‌های طلا",
    psychology:
      "لاجورد، سنگ گران‌بهای ایرانی؛ آبیِ عمیقش بیشترین حس اعتماد و اقتدار را القا می‌کند و طلای مکملش نشان‌دهندهٔ کیفیت و اصالت است. انتخاب کلاسیک برای گزارش‌های مالی.",
    category: "trust",
    iconSet: {
      dashboard: "Gem",
      invoices: "Scroll",
      "quick-invoice": "Zap",
      inventory: "Package",
      wallet: "Banknote",
      crm: "Users",
      ai: "Atom",
      pos: "Monitor",
      "reports-builder": "ChartColumn",
      referral: "Infinity",
    },
  },
  {
    id: "forest",
    nameFa: "جنگل",
    tagline: "عمق و ریشه‌داریِ جنگل کهنسال",
    psychology:
      "سبز عمیق جنگل نماد ثبات، بلوغ و ریشه‌داری است؛ برای تصمیم‌های حساب‌شده و تیم‌هایی که بلندمدت فکر می‌کنند.",
    category: "trust",
    iconSet: {
      dashboard: "Mountain",
      invoices: "BookOpen",
      "quick-invoice": "Bolt",
      inventory: "Trees",
      wallet: "Landmark",
      crm: "Contact",
      ai: "Microscope",
      pos: "Warehouse",
      "reports-builder": "ClipboardList",
      referral: "Sprout",
    },
  },
  {
    id: "amber",
    nameFa: "کهربای طلایی",
    tagline: "گرمای خورشید و انرژیِ طلایی",
    psychology:
      "کهربا رنگ خوش‌بینی و انرژی است؛ شروعِ پرانرژیِ روز کاری و حس ارزش‌آفرینی. با فیروزهٔ مکمل، تعادل گرم-سرد را حفظ می‌کند.",
    category: "energy",
    iconSet: {
      dashboard: "Sun",
      invoices: "FileText",
      "quick-invoice": "Flame",
      inventory: "Box",
      wallet: "Coins",
      crm: "Smile",
      ai: "Lightbulb",
      pos: "Barcode",
      "reports-builder": "TrendingUp",
      referral: "Star",
    },
  },
  {
    id: "coral",
    nameFa: "مرجان",
    tagline: "شور و گرمای ارتباطات مرجانی",
    psychology:
      "مرجانی، رنگ صمیمیت و شور زندگی؛ انتخابی گرم و خوش‌برخورد برای تیم‌های پرتعامل و فروشنده‌ها.",
    category: "energy",
    iconSet: {
      dashboard: "Sunrise",
      invoices: "Receipt",
      "quick-invoice": "Send",
      inventory: "Container",
      wallet: "CreditCard",
      crm: "HeartHandshake",
      ai: "Wand2",
      pos: "Smartphone",
      "reports-builder": "PieChart",
      referral: "UserPlus",
    },
  },
  {
    id: "sunset",
    nameFa: "غروب",
    tagline: "هیجان طلوع تا غروب — نارنجی، صورتی، بنفش",
    psychology:
      "گرادیان غروب: ترکیب انرژی نارنجی، عاطفهٔ صورتی و خیالِ بنفش؛ برای ذهن‌های خلاق و پرشور که تازه‌گی را در پایان روز هم حفظ می‌کنند.",
    category: "energy",
    iconSet: {
      dashboard: "Sunset",
      invoices: "Receipt",
      "quick-invoice": "Send",
      inventory: "Box",
      wallet: "HandCoins",
      crm: "Heart",
      ai: "MoonStar",
      pos: "Store",
      "reports-builder": "ChartPie",
      referral: "Star",
    },
  },
  {
    id: "rose",
    nameFa: "گل‌سرخ",
    tagline: "عاطفه، ظرافت و عشق به کار",
    psychology:
      "سرخِ گل‌سرخ نمای عاطفه و ظرافت است؛ برای کسب‌وکارهای برندمحور، فروشگاه‌های صمیمی و خدماتی که حس می‌سازند.",
    category: "emotion",
    iconSet: {
      dashboard: "Flower2",
      invoices: "Mail",
      "quick-invoice": "PenLine",
      inventory: "ShoppingBag",
      wallet: "HandCoins",
      crm: "HandHeart",
      ai: "Sparkle",
      pos: "ScanLine",
      "reports-builder": "Activity",
      referral: "Gift",
    },
  },
  {
    id: "rose-gold",
    nameFa: "رزگلد",
    tagline: "لوکسِ مدرن و لطیفِ رزگلد",
    psychology:
      "رزگلد ترکیب گرمای مسی با لطافت صورتی است؛ رنگ مد و لوکسِ مدرن که حس خاص‌بودن و سلیقهٔ پرمیوم می‌دهد.",
    category: "emotion",
    iconSet: {
      dashboard: "Shell",
      invoices: "ReceiptText",
      "quick-invoice": "Feather",
      inventory: "ShoppingBag",
      wallet: "Gem",
      crm: "HandHeart",
      ai: "Sparkle",
      pos: "MonitorSmartphone",
      "reports-builder": "ChartPie",
      referral: "Gift",
    },
  },
  {
    id: "galaxy",
    nameFa: "کهکشان",
    tagline: "سفری به عمق کهکشان راه شیری",
    psychology:
      "فوشیای کیهانی روی بوم شب؛ رنگ رؤیابینی و خیال‌پردازی. در حالت تاریک فوق‌العاده درخشان و جادویی است — برای شب‌کارهای خلاق.",
    category: "emotion",
    iconSet: {
      dashboard: "Orbit",
      invoices: "ScrollText",
      "quick-invoice": "Sparkles",
      inventory: "Boxes",
      wallet: "CircleDollarSign",
      crm: "UsersRound",
      ai: "Eclipse",
      pos: "Rocket",
      "reports-builder": "ChartSpline",
      referral: "Share2",
    },
  },
  {
    id: "terracotta",
    nameFa: "سفال ایرانی",
    tagline: "اصالت خاک و هنر صنعتگر ایرانی",
    psychology:
      "رنگ سفال، گرمای خاک و اصالت صنعتگری ایرانی؛ حس دست‌ساز و ماندگار. زمین‌گرمی که هیچ‌وقت کهنه نمی‌شود.",
    category: "minimal",
    iconSet: {
      dashboard: "Home",
      invoices: "NotebookPen",
      "quick-invoice": "Pencil",
      inventory: "Package2",
      wallet: "Banknote",
      crm: "Phone",
      ai: "Compass",
      pos: "HandPlatter",
      "reports-builder": "NotebookText",
      referral: "Link2",
    },
  },
  {
    id: "graphite",
    nameFa: "گرافیت",
    tagline: "مینیمال، دقیق، بی‌حاشیه",
    psychology:
      "خاکستری گرافیت برای تمرکز مطلق: هیچ رنگی حواس‌پرتی نمی‌آورد، فقط کار. محبوب مدیران مالی و حسابرس‌ها.",
    category: "minimal",
    iconSet: {
      dashboard: "LayoutGrid",
      invoices: "File",
      "quick-invoice": "Plus",
      inventory: "Archive",
      wallet: "CircleDollarSign",
      crm: "User",
      ai: "Cpu",
      pos: "Monitor",
      "reports-builder": "BarChart3",
      referral: "Link",
    },
  },
];

/** شناسه تم پیش‌فرض — پرچمدار روان‌شناسی‌شده (بنفش = هوش و خرد) */
export const DEFAULT_THEME_ID = "violet";

/** کلید localStorage */
export const THEME_STORAGE_KEY = "hoosh_theme";

/** رویداد سفارشی تغییر تم (برای همگام‌سازی چند نمونه از هوک) */
const THEME_CHANGE_EVENT = "hoosh-theme-change";

export const THEME_IDS = THEMES.map((t) => t.id);

/* ============================================================
 * نقشه نام آیکون → کامپوننت lucide (tree-shakeable)
 * ============================================================ */

export const THEME_ICON_COMPONENTS: Record<string, LucideIcon> = {
  // بنفشهٔ سلطنتی
  Crown,
  Scroll,
  WandSparkles,
  Layers,
  Gem,
  UsersRound,
  Orbit,
  Rocket,
  Presentation,
  Medal,
  // شفق قطبی
  Telescope,
  ReceiptText,
  Wind,
  Snowflake,
  Droplets,
  Anchor,
  Sparkle,
  Sailboat,
  ChartNoAxesColumn,
  Rainbow,
  // زمرد
  LayoutDashboard,
  ShoppingCart,
  Zap,
  Package,
  Wallet,
  Heart,
  Sparkles,
  MonitorSmartphone,
  FileBarChart,
  Users,
  // فیروزه ایرانی
  Waves,
  ScrollText,
  Feather,
  Boxes,
  PiggyBank,
  Handshake,
  Brain,
  Store,
  LineChart,
  Share2,
  // لاجورد
  Atom,
  ChartColumn,
  Infinity,
  Banknote,
  Monitor,
  // کهربای طلایی
  Sun,
  FileText,
  Flame,
  Box,
  Coins,
  Smile,
  Lightbulb,
  Barcode,
  TrendingUp,
  Star,
  // مرجان
  Sunrise,
  Receipt,
  Send,
  Container,
  CreditCard,
  HeartHandshake,
  Wand2,
  Smartphone,
  PieChart,
  UserPlus,
  // غروب
  Sunset,
  MoonStar,
  ChartPie,
  // گل‌سرخ
  Flower2,
  Mail,
  PenLine,
  ShoppingBag,
  HandCoins,
  HandHeart,
  ScanLine,
  Activity,
  Gift,
  // رزگلد
  Shell,
  // کهکشان
  ChartSpline,
  Eclipse,
  // جنگل
  Mountain,
  BookOpen,
  Bolt,
  Trees,
  Landmark,
  Contact,
  Microscope,
  Warehouse,
  ClipboardList,
  Sprout,
  // سفال ایرانی
  Home,
  NotebookPen,
  Pencil,
  Package2,
  Phone,
  Compass,
  HandPlatter,
  NotebookText,
  Link2,
  // گرافیت
  LayoutGrid,
  File,
  Plus,
  Archive,
  CircleDollarSign,
  User,
  Cpu,
  BarChart3,
  Link,
};

/* ============================================================
 * توابع خالص
 * ============================================================ */

export function getTheme(id: string | null | undefined): AppTheme {
  const found = THEMES.find((t) => t.id === id);
  return found ?? THEMES[0];
}

/** آیکون ماژول برای تم مشخص — با fallback */
export function getThemeIcon(
  themeId: string | null | undefined,
  moduleId: string,
  fallback: LucideIcon
): LucideIcon {
  const name = getThemeIconName(themeId, moduleId, "");
  const component = name ? THEME_ICON_COMPONENTS[name] : undefined;
  return component ?? fallback;
}

/** نام آیکون (رشته‌ای) ماژول برای تم مشخص — با fallback رشته‌ای */
export function getThemeIconName(
  themeId: string | null | undefined,
  moduleId: string,
  fallback: string
): string {
  const theme = getTheme(themeId);
  return theme.iconSet[moduleId] ?? fallback;
}

/* ============================================================
 * اعمال تم روی DOM + localStorage
 * ============================================================ */

export function applyThemeToDom(id: string | null | undefined) {
  if (typeof document === "undefined") return;
  const theme = getTheme(id);
  document.documentElement.dataset.theme = theme.id;
}

export function getStoredThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value && THEME_IDS.includes(value)) return value;
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME_ID;
}

/** نام مستعار قدیمی برای سازگاری داخلی */
export const readStoredThemeId = getStoredThemeId;

export function storeThemeId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent<string>(THEME_CHANGE_EVENT, { detail: id }));
}

/* اعمال اولیه هنگام import ماژول در مرورگر (الگوی settings-dialog)
   — تم پیش از paint روی <html> می‌نشیند */
if (typeof window !== "undefined") {
  applyThemeToDom(getStoredThemeId());
}

/* ============================================================
 * هوک‌های کلاینت
 * ============================================================ */

/**
 * useAppTheme — خواندن/نوشتن تم انتخاب‌شده.
 * تغییر تم بلافاصله روی document اعمال و در localStorage ذخیره می‌شود
 * و همهٔ نمونه‌های دیگر هوک (و تب‌های دیگر) همگام می‌شوند.
 */
export function useAppTheme() {
  const [themeId, setThemeId] = React.useState<string>(DEFAULT_THEME_ID);

  React.useEffect(() => {
    const stored = getStoredThemeId();
    setThemeId(stored);
    applyThemeToDom(stored);

    const sync = (nextId: string | null | undefined) => {
      const theme = getTheme(nextId ?? getStoredThemeId());
      setThemeId(theme.id);
      applyThemeToDom(theme.id);
    };

    const onCustomChange = (event: Event) => {
      sync((event as CustomEvent<string>).detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) sync(getStoredThemeId());
    };

    window.addEventListener(THEME_CHANGE_EVENT, onCustomChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onCustomChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setAppTheme = React.useCallback((id: string) => {
    const theme = getTheme(id);
    storeThemeId(theme.id);
    setThemeId(theme.id);
    applyThemeToDom(theme.id);
  }, []);

  return {
    themeId,
    theme: getTheme(themeId),
    setAppTheme,
    isDefault: themeId === DEFAULT_THEME_ID,
  };
}

/**
 * useThemeIcon — آیکون ماژول مطابق تم فعال.
 * نمونه: const WalletIcon = useThemeIcon("wallet", Wallet);
 */
export function useThemeIcon(moduleId: string, fallback: LucideIcon): LucideIcon {
  const { themeId } = useAppTheme();
  return React.useMemo(
    () => getThemeIcon(themeId, moduleId, fallback),
    [themeId, moduleId, fallback]
  );
}
