import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#17405B",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32">
          <path
            d="M11.2 22.4V9.6h5.1c2.7 0 4.4 1.6 4.4 3.9 0 1.5-.8 2.7-2.1 3.3 1.6.5 2.6 1.8 2.6 3.6 0 2.5-1.8 4-4.8 4h-5.2zm2.4-7.3h2.4c1.3 0 2.1-.7 2.1-1.8s-.8-1.8-2.1-1.8h-2.4v3.6zm0 5.5h2.8c1.5 0 2.4-.8 2.4-2s-.9-2-2.4-2h-2.8v4z"
            fill="#FFFFFF"
          />
          <path
            d="M8 25.2c2.4 1.7 5.1 2.4 8 2.4s5.6-.7 8-2.4"
            stroke="#AD8859"
            strokeWidth="1.6"
            fill="none"
          />
        </svg>
      </div>
    ),
    size,
  );
}
