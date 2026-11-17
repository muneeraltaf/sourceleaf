import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

const montserrat = localFont({
  src: "../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2",
  variable: "--font-montserrat",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "sourceleaf. — A little more clarity.",
  description: "Turn your PDFs and Word documents into a conversation. Ask, understand, and explore answers with sources.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body><a className="skip-link" href="#conversation">Skip to conversation</a>{children}</body>
    </html>
  );
}
