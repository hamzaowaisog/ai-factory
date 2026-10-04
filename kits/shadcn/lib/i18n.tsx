// @client
// The product's words in its other language: the screens are written in English and shown through t().
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MESSAGES, RTL } from "./messages";

interface I18n {
  lang: string; dir: "ltr" | "rtl"; t: (text: string) => string;
  /** the product's languages (English first, then any in MESSAGES), and a switch between them */
  langs: string[]; setLang: (lang: string) => void;
}
const Ctx = createContext<I18n>({ lang: "en", dir: "ltr", t: (s) => s, langs: ["en"], setLang: () => {} });

export function I18nProvider({ lang, children }: { lang?: string; children: ReactNode }) {
  const [picked, setLang] = useState(lang);
  // ?lang=ur opens the page in that language (the fidelity check and the generated tests use it)
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("lang"); if (q && MESSAGES[q]) setLang(q); }, []);
  const l = picked && MESSAGES[picked] ? picked : "en";
  const words = MESSAGES[l] ?? {};
  const value: I18n = { lang: l, dir: RTL.includes(l) ? "rtl" : "ltr", t: (s) => words[s] ?? s, langs: ["en", ...Object.keys(MESSAGES).filter((x) => x !== "en")], setLang };
  return (
    <Ctx.Provider value={value}>
      <div lang={value.lang} dir={value.dir} className="contents">{children}</div>
    </Ctx.Provider>
  );
}

/** The translator: the English text in, the shown text out. */
export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx);
