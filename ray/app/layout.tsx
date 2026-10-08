import type { Metadata } from "next";
import { Inter, Jersey_25 } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jersey25 = Jersey_25({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jersey",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ray Dashboard",
  description:
    "PutmeIn ray: Monitor servers, deploy applications, and manage your infrastructure with AI-powered assistance.",
  keywords: ["server monitoring", "deployment", "devops", "dashboard", "AI"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jersey25.variable}`}>
      <body suppressHydrationWarning className="min-h-screen bg-black text-white font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
