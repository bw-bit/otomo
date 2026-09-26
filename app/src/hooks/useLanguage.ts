"use client";

import { useCallback, useEffect, useState } from "react";
import { isLang, type Lang } from "@/lib/i18n";

const LANGUAGE_STORAGE_KEY = "otomo.lang";

export function useLanguage(): { lang: Lang; setLang: (lang: Lang) => void } {
  const [lang, setLangValue] = useState<Lang>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // Keep the English default when browser storage is unavailable.
    }
    const initial = isLang(stored) ? stored : "en";
    setLangValue(initial);
    document.documentElement.lang = initial;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // The current page still follows the selected language without storage.
    }
  }, [lang, ready]);

  const setLang = useCallback((next: Lang) => setLangValue(next), []);
  return { lang, setLang };
}
