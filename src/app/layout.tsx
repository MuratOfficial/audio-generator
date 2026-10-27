import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeScript } from "@toimetdev/pathlogs-tokens";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Агу — синтез звуков и детских голосов",
  description: "Синтезатор детских голосов, звуков игрушек и игровых эффектов прямо в браузере.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Атрибут data-theme ставит themeScript до гидратации — отсюда suppressHydrationWarning.
    <html lang="ru" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
