import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "aiq | visual reasoning test",
  description: "Fresh visual reasoning tests for humans and AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
