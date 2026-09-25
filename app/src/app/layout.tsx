import type { Metadata } from "next";
import { M_PLUS_Rounded_1c, Noto_Sans_SC, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// M PLUS Rounded 1c covers ja+latin; Noto Sans SC / KR cover the other UI languages.
// `subsets` only picks what gets preloaded — all unicode-range slices still load.
const mPlus = M_PLUS_Rounded_1c({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-mplus" });
const notoSC = Noto_Sans_SC({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-noto-sc" });
const notoKR = Noto_Sans_KR({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-noto-kr" });

export const metadata: Metadata = {
  title: "Otomo — 世界に一人の相棒",
  description: "顔で生まれる、あなただけの相棒エージェント",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${mPlus.variable} ${notoSC.variable} ${notoKR.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
