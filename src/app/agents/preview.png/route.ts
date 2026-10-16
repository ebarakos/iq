import { Resvg } from "@resvg/resvg-js";

export const dynamic = "force-static";
export const runtime = "nodejs";

// A fixed image check, separate from the question bank and every timed test.
const PREVIEW = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160">
<rect width="480" height="160" fill="white"/>
<circle cx="80" cy="80" r="36" fill="#111827"/>
<rect x="204" y="44" width="72" height="72" fill="none" stroke="#111827" stroke-width="5"/>
<polygon points="400,39 442,113 358,113" fill="#9ca3af" stroke="#111827" stroke-width="5" stroke-linejoin="round"/>
</svg>`;

/** Serve only PNG bytes, without starting a test or consulting Redis. */
export function GET() {
  const png = new Resvg(PREVIEW, { font: { loadSystemFonts: false } }).render().asPng();
  return new Response(Buffer.from(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
