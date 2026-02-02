import type { Metadata } from "next";
import { JetBrains_Mono, Sora, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const notoserif = Noto_Serif_SC({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Novel Assistant",
  description: "AI-powered novel writing assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${sora.variable} ${notoserif.variable} ${jetBrainsMono.variable} antialiased h-full`}
      >
        {children}
      </body>
    </html>
  );
}
