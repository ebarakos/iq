import { ImageResponse } from "next/og";

/** Home-screen icon: the favicon's marks, full-bleed because iOS rounds the corners itself. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#111827" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <circle cx="10.5" cy="10.5" r="4.5" fill="#ffffff" />
          <circle cx="21.5" cy="10.5" r="4.5" fill="#ffffff" />
          <circle cx="10.5" cy="21.5" r="4.5" fill="#ffffff" />
          <circle cx="21.5" cy="21.5" r="3.5" fill="none" stroke="#ffffff" strokeWidth="2" />
        </svg>
      </div>
    ),
    size,
  );
}
