// The product's languages and local formats (docs/estimates-design.md, "Design phases", gaps 17 and 18). The design's sample
// content is written in English, so code can read its statuses, amounts and dates; each page carries its words in the product's
// other language (`tr`), and the demo shows the page in either language, mirrored for a right-to-left one, with the market's
// first weekday, weekend and digits. This file holds what code knows about languages and markets, and the checks the design step
// runs on a design's locale.
import type { Button, DesignLocale, ScreenMock, Translation } from "../contracts/artifacts.js";

const RTL = new Set(["ar", "ur", "fa", "he", "ps", "sd", "ug", "yi", "dv", "ckb"]);
const ARABIC_SCRIPT = new Set(["ar", "ur", "fa", "ps", "sd", "ug", "ckb"]);
const base = (lang: string): string => lang.split("-")[0]!.toLowerCase();
export const isRtl = (lang: string): boolean => RTL.has(base(lang));

/** The letters a language is written in, when it is not the Latin alphabet: its text must use them. */
const SCRIPT: Record<string, RegExp> = {
  ar: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/, he: /[֐-׿]/, hi: /[ऀ-ॿ]/, bn: /[ঀ-৿]/,
  zh: /[一-鿿]/, ja: /[぀-ヿ一-鿿]/, ko: /[가-힯]/, ru: /[Ѐ-ӿ]/, el: /[Ͱ-Ͽ]/, th: /[฀-๿]/,
};
export const scriptOf = (lang: string): RegExp | undefined => SCRIPT[ARABIC_SCRIPT.has(base(lang)) ? "ar" : base(lang)];

/** The digits an Arabic-script language writes with, when the design asks for the script's own. */
export const nativeDigits = (lang: string): string => (base(lang) === "ar" ? "٠١٢٣٤٥٦٧٨٩" : ARABIC_SCRIPT.has(base(lang)) ? "۰۱۲۳۴۵۶۷۸۹" : "");

// a language's name in its own words, for the frame's language button (fixed here so the page is the same on every machine)
const NATIVE: Record<string, string> = {
  en: "English", ar: "العربية", ur: "اردو", fa: "فارسی", he: "עברית", ps: "پښتو", sd: "سنڌي", fr: "Français", es: "Español", de: "Deutsch",
  tr: "Türkçe", hi: "हिन्दी", bn: "বাংলা", zh: "中文", ms: "Bahasa Melayu", id: "Bahasa Indonesia", pt: "Português", it: "Italiano", ru: "Русский",
};
const ENGLISH: Record<string, string> = {
  en: "English", ar: "Arabic", ur: "Urdu", fa: "Persian", he: "Hebrew", ps: "Pashto", sd: "Sindhi", fr: "French", es: "Spanish", de: "German",
  tr: "Turkish", hi: "Hindi", bn: "Bengali", zh: "Chinese", ms: "Malay", id: "Indonesian", pt: "Portuguese", it: "Italian", ru: "Russian",
};
export const nativeName = (lang: string): string => NATIVE[base(lang)] ?? lang;
export const englishName = (lang: string): string => ENGLISH[base(lang)] ?? lang;

// the market's first weekday and weekend, Monday = 0 (CLDR, fixed here so a calendar is drawn the same everywhere)
const SUNDAY_FIRST = new Set(["US", "CA", "MX", "BR", "JP", "IL", "SA", "PH", "IN", "KR", "TW", "HK", "ZA", "PE", "CO", "VE", "GT", "HN", "SV", "NI", "PA", "DO", "PR", "KE", "ET", "BD", "NP", "TH", "KH", "LA", "MM", "ID", "PK"].filter((r) => r !== "PK"));
const SATURDAY_FIRST = new Set(["EG", "IR", "QA", "KW", "BH", "OM", "DZ", "LY", "SY", "IQ", "JO", "AF", "SD"]);
const FRI_SAT = new Set(["SA", "EG", "QA", "KW", "BH", "OM", "DZ", "IQ", "JO", "LY", "SY", "SD", "YE"]);
export const weekStart = (region?: string): number => (!region ? 0 : SUNDAY_FIRST.has(region) ? 6 : SATURDAY_FIRST.has(region) ? 5 : 0);
export const weekend = (region?: string): number[] => (region === "IR" ? [4] : region === "AF" ? [3, 4] : region && FRI_SAT.has(region) ? [4, 5] : [5, 6]);

/**
 * The demo's own words (the frame, the states, the parts code draws) in the languages the factory knows, so a page reads wholly
 * in that language without the model translating them. "{x}" is the rest of a sentence code writes (a count, a name).
 */
const WORDS: Record<string, Record<string, string>> = {
  ar: {
    Search: "بحث", Settings: "الإعدادات", Help: "المساعدة", Menu: "القائمة", Notifications: "الإشعارات", Filters: "الفلاتر", Undo: "تراجع",
    "Try again": "حاول مرة أخرى", Clear: "مسح", "Clear all": "مسح الكل", "Mark all as read": "تحديد الكل كمقروء", Unread: "غير مقروءة", All: "الكل",
    Item: "البند", Qty: "الكمية", Amount: "المبلغ", From: "من", To: "إلى", Feature: "الميزة", Actions: "الإجراءات", Total: "الإجمالي", Select: "اختر",
    "What this fills with": "ما ستعرضه هذه الصفحة", "Nothing here yet": "لا يوجد شيء هنا بعد", "When there is something to show, it appears here.": "عندما يتوفر ما يُعرض، سيظهر هنا.",
    "Something went wrong. Try again in a moment.": "حدث خطأ ما. حاول مرة أخرى بعد قليل.", "Done.": "تم.", "Check the highlighted details and try again.": "تحقق من التفاصيل المحددة وحاول مرة أخرى.",
    "Write a message": "اكتب رسالة", "Drag files here or": "اسحب الملفات إلى هنا أو", browse: "تصفّح", "Times on": "المواعيد يوم", Failed: "فشل", Uploaded: "تم الرفع",
    Saved: "تم الحفظ", Now: "الآن", Yes: "نعم", No: "لا", Close: "إغلاق", Send: "إرسال", Save: "حفظ", More: "المزيد", Language: "اللغة",
    Mon: "إثنين", Tue: "ثلاثاء", Wed: "أربعاء", Thu: "خميس", Fri: "جمعة", Sat: "سبت", Sun: "أحد",
    "Moved to {x}": "نُقل إلى {x}", "Switched to {x}": "تم التبديل إلى {x}", "{x} done": "تم: {x}", "{x} new": "{x} جديدة", "{x} of {y}": "{x} من {y}",
    "{x} results": "{x} نتيجة", "{x} result": "{x} نتيجة", selected: "محدد", "{x} out of 5": "{x} من 5",
    "Switch {x}": "تبديل {x}", account: "الحساب", workspace: "مساحة العمل", company: "الشركة", location: "الفرع", profile: "الملف الشخصي",
  },
  ur: {
    Search: "تلاش", Settings: "ترتیبات", Help: "مدد", Menu: "مینو", Notifications: "اطلاعات", Filters: "فلٹرز", Undo: "واپس لیں",
    "Try again": "دوبارہ کوشش کریں", Clear: "صاف کریں", "Clear all": "سب صاف کریں", "Mark all as read": "سب کو پڑھا ہوا کریں", Unread: "غیر پڑھی", All: "سب",
    Item: "آئٹم", Qty: "تعداد", Amount: "رقم", From: "منجانب", To: "بنام", Feature: "خصوصیت", Actions: "اقدامات", Total: "کل", Select: "منتخب کریں",
    "What this fills with": "یہ صفحہ کیا دکھائے گا", "Nothing here yet": "ابھی یہاں کچھ نہیں", "When there is something to show, it appears here.": "جب دکھانے کو کچھ ہوگا تو یہاں نظر آئے گا۔",
    "Something went wrong. Try again in a moment.": "کچھ غلط ہو گیا۔ تھوڑی دیر میں دوبارہ کوشش کریں۔", "Done.": "ہو گیا۔", "Check the highlighted details and try again.": "نمایاں تفصیلات دیکھیں اور دوبارہ کوشش کریں۔",
    "Write a message": "پیغام لکھیں", "Drag files here or": "فائلیں یہاں لائیں یا", browse: "منتخب کریں", "Times on": "اوقات برائے", Failed: "ناکام", Uploaded: "اپ لوڈ ہو گئی",
    Saved: "محفوظ ہو گیا", Now: "ابھی", Yes: "ہاں", No: "نہیں", Close: "بند کریں", Send: "بھیجیں", Save: "محفوظ کریں", More: "مزید", Language: "زبان",
    Mon: "پیر", Tue: "منگل", Wed: "بدھ", Thu: "جمعرات", Fri: "جمعہ", Sat: "ہفتہ", Sun: "اتوار",
    "Moved to {x}": "{x} میں منتقل", "Switched to {x}": "{x} پر منتقل ہو گئے", "{x} done": "{x} مکمل", "{x} new": "{x} نئی", "{x} of {y}": "{y} میں سے {x}",
    "{x} results": "{x} نتائج", "{x} result": "{x} نتیجہ", selected: "منتخب", "{x} out of 5": "5 میں سے {x}",
    "Switch {x}": "{x} تبدیل کریں", account: "اکاؤنٹ", workspace: "ورک اسپیس", company: "کمپنی", location: "برانچ", profile: "پروفائل",
  },
};
export const demoWords = (lang: string): Record<string, string> => WORDS[base(lang)] ?? {};

/** The language the page's English is shown in: the design's languages other than English (one at most). */
export const otherLanguage = (loc?: DesignLocale): string | undefined => loc?.languages.find((l) => base(l) !== "en");

/**
 * The words a page must show in the other language: its title, trail, tabs, headings, labels, buttons, column headers, statuses,
 * the words of its layers, toasts and states. Names, places, amounts and codes in the data may stay as written.
 */
export function pageLabels(m: ScreenMock): string[] {
  const out: string[] = [m.title, m.subtitle ?? "", m.badge ?? "", ...(m.crumbs ?? []), ...(m.tabs ?? []), ...Object.values(m.copy ?? {})];
  // a button's label, its tooltip and its split menu's choices
  const btns = (list: Button[]) => list.flatMap((x) => (typeof x === "string" ? [x] : [x.label, x.hint ?? "", ...(x.menu ?? [])]));
  const blocks = (list: ScreenMock["blocks"]) => {
    for (const b of list) {
      switch (b.type) {
        case "stats": out.push(...b.items.map((s) => s.label)); break;
        case "filters": out.push(b.search ?? "", ...b.chips, ...(b.segments ?? [])); break;
        case "table": out.push(...b.columns, ...btns(b.bulk ?? []), ...(b.statusColumn !== undefined ? b.rows.map((r) => r[b.statusColumn!] ?? "") : [])); break;
        case "form": out.push(...b.fields.flatMap((f) => [f.label, f.help ?? "", f.error ?? "", f.hint ?? "", ...(f.options ?? [])]), b.submit); break;
        case "chart": out.push(b.title, ...(b.ranges ?? []), ...(b.series ?? [])); break;
        case "cards": out.push(...b.items.map((i) => i.badge ?? "")); break;
        case "list": out.push(...b.items.map((i) => i.badge ?? "")); break;
        case "actions": out.push(...btns(b.buttons)); break;
        case "alert": out.push(b.title ?? "", b.text, b.action ?? ""); break;
        case "toolbar": out.push(b.search ?? "", ...b.selects.flatMap((x) => [x.label, ...x.options]), ...btns(b.buttons)); break;
        case "progress": out.push(b.title ?? "", ...b.items.flatMap((i) => [i.label, i.meta ?? ""])); break;
        case "steps": out.push(...b.items); break;
        case "detail": out.push(b.title ?? "", b.lead?.label ?? "", ...b.rows.flatMap((r) => (r.badge ? [r.label, r.value] : [r.label]))); break;
        case "carousel": out.push(b.title ?? "", ...b.items.flatMap((i) => [i.badge ?? "", i.cta ?? ""])); break;
        case "kanban": out.push(...b.columns.map((c) => c.title)); break;
        case "plans": out.push(...b.items.flatMap((i) => [i.name, i.cta, ...i.features]), ...(b.periods ?? [])); break;
        case "results": out.push(b.count, ...(b.sort ?? []), ...b.facets.flatMap((f) => [f.title, ...f.options])); break;
        case "compare": out.push(...b.rows.map((r) => r.label), b.cta ?? ""); break;
        case "receipt": out.push(b.title, b.status ?? "", ...b.facts.map((f) => f.label), ...b.totals.map((t) => t.label)); break;
        case "upload": out.push(b.label, b.hint ?? ""); break;
        case "accordion": out.push(...b.items.map((i) => i.title)); break;
        case "notifications": out.push(...b.items.map((i) => i.group ?? "")); break;
        default: break;
      }
    }
  };
  blocks(m.blocks);
  for (const o of m.overlays ?? []) { out.push(o.title, o.text ?? "", ...btns(o.actions), ...(o.items ?? [])); blocks(o.blocks); }
  for (const t of m.toasts ?? []) out.push(t.text);
  // a word is a label, not data: numbers, codes and amounts read the same in both languages
  return [...new Set(out.map((s) => s.trim()).filter((s) => s && /\p{L}{2}/u.test(s) && !/^[A-Z]{2,5}$/.test(s)))];
}

// the languages, markets and right-to-left words requirements use when the product must speak more than English
const LANG_WORDS = /\b(arabic|urdu|persian|farsi|hebrew|pashto|sindhi|kurdish|french|spanish|german|turkish|hindi|bengali|chinese|malay|indonesian|portuguese|russian|rtl|right[- ]to[- ]left|bilingual|multilingual|multi-language|two languages|localised|localized|locali[sz]ation|i18n)\b/i;
const MONEY = /(?:^|[\s(])(?:([$€£¥₹₨])|\b(PKR|USD|AED|SAR|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JPY|CNY|CAD|AUD|MYR|IDR|TRY|BDT)\b|\b(Rs)\.?)\s?\d/g;
const SYMBOL: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₨": "PKR", Rs: "PKR" };
const SLASH_DATE = /\b(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
const EASTERN = /[٠-٩۰-۹]/;

/** Everything a design's pages and frame show, as text: the content code reads. Translations are left out. */
function shown(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(shown).join(" | ");
  if (v && typeof v === "object") return Object.entries(v).filter(([k]) => k !== "tr" && k !== "strings").map(([, x]) => shown(x)).join(" | ");
  return "";
}

type Pageish = { id: string; mock?: ScreenMock | undefined; mockFull?: unknown };
/**
 * A design's languages and formats fit its requirements and agree with its pages: a product whose requirements name a language
 * or right-to-left has a locale; content is English with every page's words translated, in the language's own letters; numbers
 * use the digits 0-9 (the demo shows a script's own); dates follow the market's order; amounts are in the product's money.
 */
export function localeFit(out: { locale?: DesignLocale | undefined; screens: Pageish[] }, reqText: string): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  const say = (message: string) => bad.push({ check: "design-locale", message });
  const loc = out.locale;
  const named = reqText.match(LANG_WORDS)?.[0];
  if (!loc) {
    if (named) say(`The requirements name "${named}", but the design has no "locale". Give the languages the product is offered in (the first is the one it opens in), its region, currency, date order and digits, and each page's words in the other language ("tr").`);
    return bad;
  }
  const langs = loc.languages.map(base);
  if (new Set(langs).size !== langs.length) say(`"locale.languages" lists ${loc.languages.join(", ")}: name each language once.`);
  if (langs.length === 2 && !langs.includes("en")) say(`"locale.languages" is ${loc.languages.join(" and ")}. The sample content is written in English, so a product with two languages has English as one of them (a product in one other language lists only that one).`);
  const other = otherLanguage(loc);
  const content = shown(out.screens.map((s) => [s.mock, s.mockFull]));
  if (EASTERN.test(content)) say("The sample content writes numbers with Arabic or Persian digits. Write every number with 0-9; with \"digits\": \"native\" the demo shows the script's own.");
  // dates as numbers follow the market's order: a day past 12 shows which order the content used
  const wrong: string[] = [];
  for (const m of content.matchAll(SLASH_DATE)) {
    const [a, b2, c] = [+m[1]!, +m[2]!, +m[3]!], ymd = m[1]!.length === 4;
    const fits = loc.dates === "ymd" ? ymd && b2 <= 12 : ymd ? false : loc.dates === "dmy" ? b2 <= 12 && a <= 31 : a <= 12 && b2 <= 31;
    if (!fits && c >= 0 && wrong.length < 3) wrong.push(m[0]);
  }
  if (wrong.length) say(`The sample dates ${wrong.map((w) => `"${w}"`).join(", ")} are not written ${loc.dates === "dmy" ? "day/month/year" : loc.dates === "mdy" ? "month/day/year" : "year-month-day"}, the order "locale.dates" gives for ${loc.region}. Write every date in that order.`);
  // the product's money: amounts in another currency may appear (a transfer abroad), but most are in the product's own
  const codes = [...content.matchAll(MONEY)].map((m) => (m[2] ?? SYMBOL[m[1] ?? m[3] ?? ""] ?? ""));
  const foreign = codes.filter((c) => c && c !== loc.currency);
  if (codes.length >= 2 && foreign.length * 2 > codes.length) say(`Most amounts in the sample content are in ${[...new Set(foreign)].join(", ")}, but the product's money ("locale.currency") is ${loc.currency}. Write amounts in ${loc.currency}, as the market reads them.`);
  if (!other) return bad;
  // every page shows its words in the other language, written in that language's letters
  const script = scriptOf(other);
  for (const s of out.screens) {
    if (!s.mock) continue;
    const tr = new Map((s.mock.tr ?? []).map((t) => [t.from.trim(), t.to.trim()]));
    const missing = pageLabels(s.mock).filter((l) => !tr.has(l));
    if (missing.length) say(`Screen ${s.id} has no ${englishName(other)} for ${missing.slice(0, 8).map((x) => `"${x}"`).join(", ")}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}. Give "tr" an entry for every word the page shows (title, labels, buttons, column headers, statuses, its layers' and toasts' words), "from" exactly as written on the page.`);
    if (script) {
      const latin = (s.mock.tr ?? []).filter((t) => /\p{L}{3}/u.test(t.from) && !script.test(t.to) && t.to !== t.from);
      const words = (s.mock.tr ?? []).filter((t) => /\p{L}{3}/u.test(t.from));
      if (words.length && latin.length * 3 > words.length) say(`Screen ${s.id}'s ${englishName(other)} is not written in its own letters (${latin.slice(0, 3).map((t) => `"${t.to}"`).join(", ")}). Write ${englishName(other)} in its script, not transliterated.`);
    }
  }
  return bad;
}

/** A page's words and the frame's in one table, English to the other language, later entries first. */
export function translationTable(...lists: (Translation | undefined)[]): Record<string, string> {
  const t: Record<string, string> = {};
  for (const list of lists) for (const e of list ?? []) if (e.from.trim() && e.to.trim()) t[e.from.trim()] = e.to.trim();
  return t;
}

const DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** What the build is told about the product's languages and market: the same choices the approved demo was drawn with. */
export function localeBrief(loc: DesignLocale): Record<string, unknown> {
  const rtl = loc.languages.filter(isRtl);
  return {
    languages: loc.languages.map((l) => ({ code: l, name: englishName(l), direction: isRtl(l) ? "rtl" : "ltr" })), opensIn: loc.languages[0],
    region: loc.region, currency: loc.currency, dateOrder: loc.dates, digits: loc.digits,
    weekStartsOn: DAY[weekStart(loc.region)], weekend: weekend(loc.region).map((d) => DAY[d]),
    ...(loc.strings?.length ? { frameStrings: loc.strings } : {}),
    note: [
      loc.languages.length > 1 ? `Offer the product in ${loc.languages.map(englishName).join(" and ")}, opening in ${englishName(loc.languages[0]!)}, with a language switch in the frame. Keep every string in the app's translation files (or add them): each page's English and its translation are its sample content's "tr" pairs.` : `Write the product in ${englishName(loc.languages[0]!)}: each page's words are its sample content's "tr" pairs.`,
      rtl.length ? `${rtl.map(englishName).join(" and ")} read right to left: set dir="rtl" and lang on the root when it shows, style with logical properties (margin-inline-start, padding-inline-end, inset-inline-start, text-align: start, border-inline-end) so the layout mirrors, mirror the icons that point along the reading (back, next, send, chevrons), and keep charts, maps, phone numbers, codes, times and media controls left to right. Set Arabic-script text in fonts made for it, with no letter spacing.` : "",
      `Format numbers, money and dates with Intl for the market (new Intl.NumberFormat("${loc.languages[0]}-${loc.region}", { style: "currency", currency: "${loc.currency}" }), Intl.DateTimeFormat), ${loc.digits === "native" ? "with the script's own digits, " : "with the digits 0-9, "}dates in ${loc.dates === "dmy" ? "day-month-year" : loc.dates === "mdy" ? "month-day-year" : "year-month-day"} order; calendars start the week on ${DAY[weekStart(loc.region)]}.`,
    ].filter(Boolean).join(" "),
  };
}
