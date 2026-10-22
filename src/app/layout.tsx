import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Fira_Code } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Toaster } from 'sonner';

const customFont = Space_Grotesk({
  variable: "--font-custom",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const customMono = Fira_Code({
  variable: "--font-custom-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Kaktus",
  description: "AI-assisted circuit, PCB, firmware, and hardware validation workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${customFont.variable} ${customMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans relative">
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster richColors closeButton />
        <div className="fixed bottom-2 left-2 z-[9999] bg-black/40 backdrop-blur-sm text-white/50 font-mono text-[10px] px-2 py-1 rounded border border-white/10 pointer-events-none select-none tracking-wider uppercase">
          Prototype Version
        </div>
      </body>
    </html>
  );
}
