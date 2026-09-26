"use client";

import { LANG_LABELS, SUPPORTED_LANGS, t, type Lang } from "@/lib/i18n";

export function LanguageSelect({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span>{t("language", lang)}</span>
      <select
        className="langsel"
        aria-label={t("language", lang)}
        value={lang}
        onChange={(event) => {
          const next = event.target.value;
          if ((SUPPORTED_LANGS as readonly string[]).includes(next)) setLang(next as Lang);
        }}
      >
        {SUPPORTED_LANGS.map((value) => <option key={value} value={value}>{LANG_LABELS[value]}</option>)}
      </select>
    </label>
  );
}
