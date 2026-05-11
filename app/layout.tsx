import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// SS-008: PWA meta（manifest / apple-mobile-web-app-capable）
// SS-013: Logo applied via Next.js 16 file-conventions:
//   - app/icon.png            → favicon / browser tab
//   - app/apple-icon.png      → iPhone home-screen
//   - app/opengraph-image.png → OGP / Twitter (auto-bound to twitter.images too)
// PWA manifest icons remain in /public/icons/* so manifest.json can reference them.
export const metadata: Metadata = {
  metadataBase: new URL("https://ss-schedule.vercel.app"),
  title: "SS_schedule",
  description: "スクショから Google カレンダーへ 1 タップ登録",
  manifest: "/manifest.json",
  openGraph: {
    title: "SS_schedule",
    description: "スクショ・文章から Google カレンダーへ予定を自動登録",
    url: "https://ss-schedule.vercel.app",
    siteName: "SS_schedule",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SS_schedule",
    description: "スクショ・文章から Google カレンダーへ予定を自動登録",
  },
  appleWebApp: {
    capable: true,
    title: "SS_schedule",
    statusBarStyle: "default",
  },
};

// Next.js 16: themeColor は viewport export 側に分離されている。
// viewportFit: "cover" は iPhone のノッチ/ホームインジケータ領域まで描画を広げ、
// 各画面で env(safe-area-inset-*) を使ってコンテンツを退避できるようにする。
export const viewport: Viewport = {
  themeColor: "#0f172a",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        {children}
      </body>
    </html>
  );
}
