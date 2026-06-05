import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "aiq — visual IQ test",
  description: "Visual, language-independent IQ-style puzzles for humans and agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Widget URL derived from RELAY_BASE_URL (strip /v1, append /widget.js).
  const relayBase = process.env.RELAY_BASE_URL;
  const widgetSrc = relayBase ? `${relayBase.replace(/\/v1$/, "")}/widget.js` : null;

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
        {/* llm-relay widget: lets the user pick provider/model and enter a BYO key
            in-browser (sent as headers on /api/generate). aiq still works without it
            via the server's env default, so a load failure is non-blocking. */}
        {widgetSrc && (
          <Script
            id="llm-relay-widget-loader"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(){var s=document.createElement("script");s.src=${JSON.stringify(widgetSrc)};s.setAttribute("data-provider",${JSON.stringify(process.env.RELAY_PROVIDER ?? "")});s.setAttribute("data-model",${JSON.stringify(process.env.RELAY_MODEL ?? "")});s.onerror=function(){console.warn("[llm-relay] widget failed to load \\u2014 model selection unavailable; using the server default model.")};(document.head||document.documentElement).appendChild(s)})();`,
            }}
          />
        )}
      </body>
    </html>
  );
}
