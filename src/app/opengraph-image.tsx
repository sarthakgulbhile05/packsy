import { ImageResponse } from "next/og";

export const alt = "Orbitly: products travel with people";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link preview card for every page. Brand colours only, no product claims. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 88, background: "#101C35", color: "#FFFFFF" }}>
        <div style={{ fontSize: 44, fontWeight: 700, color: "#20C7B5", letterSpacing: -1 }}>orbitly</div>
        <div style={{ marginTop: 28, fontSize: 76, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 960 }}>Products travel with people.</div>
        <div style={{ marginTop: 36, fontSize: 30, color: "rgba(255,255,255,0.7)" }}>Abroad → India · India → Abroad · Early public preview</div>
      </div>
    ),
    size,
  );
}
