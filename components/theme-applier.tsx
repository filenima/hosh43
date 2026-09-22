"use client";

/**
 * ThemeApplier — اعمال تم ذخیره‌شده روی <html> هنگام بارگذاری برنامه.
 *
 * داخل AppProviders mount می‌شود تا data-theme مربوط به انتخاب کاربر
 * (یا پیش‌فرض «بنفشه») روی documentElement بنشیند. خود theme-registry
 * هم هنگام import ماژول تم را اعمال می‌کند؛ این کامپوننت برای اطمینان
 * (و همگام‌سازی پس از hydration) مقدار را اعمال می‌کند.
 *
 * ارتقا (2-d — گزارش مالک: «تم‌ها فقط نمایشی‌اند»): به‌جای اعمال یک‌باره در
 * mount، از هوک useAppTheme استفاده می‌کند تا تغییر تم از هر نقطهٔ برنامه
 * (دیالوگ تنظیمات، نوار سریع تم) بلافاصله روی <html data-theme> بنشیند و
 * همهٔ صفحات (از جمله لندینگ بدون app-shell) همیشه با تم فعال رنگ شوند.
 */

import * as React from "react";
import { useAppTheme } from "@/lib/theme-registry";

export function ThemeApplier() {
 // هوک در mount مقدار ذخیره‌شده را اعمال می‌کند و روی رویداد تغییر تم
 // (CustomEvent + storage بین تب‌ها) دوباره اعمال می‌کند
 useAppTheme();
 return null;
}

export default ThemeApplier;
