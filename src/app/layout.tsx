import type { Metadata } from "next";
import "./globals.css";

const title = "IQ visual reasoning gym";
const description = "A visual reasoning gym for humans and AI agents.";

// The icons and the link-preview image come from the icon.svg, apple-icon.tsx and
// opengraph-image.tsx files beside this one; on Vercel, Next resolves their
// absolute URLs from the deployment's own domain.
export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image" },
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
