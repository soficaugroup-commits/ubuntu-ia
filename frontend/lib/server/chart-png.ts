import { deflateSync } from "node:zlib";
import type { DocChart } from "@/lib/server/document-spec";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export function renderChartPng(chart: DocChart, colors: string[], width = 720, height = 380): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  fillRect(rgba, width, 0, 0, width, height, hexRgb("FFFFFF"));
  const palette = (colors.length ? colors : ["17405B", "AD8859", "3D6A82", "C4A574"]).map(hexRgb);
  if (chart.kind === "pie") drawPie(rgba, width, height, chart, palette);
  else if (chart.kind === "line") drawLine(rgba, width, height, chart, palette);
  else drawColumns(rgba, width, height, chart, palette, chart.kind === "bar");
  return encodePng(width, height, rgba);
}

function drawColumns(
  rgba: Uint8Array,
  width: number,
  height: number,
  chart: DocChart,
  palette: Rgb[],
  horizontal: boolean,
) {
  const pad = 36;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const max = Math.max(1, ...chart.series.flatMap((series) => series.values));
  const groups = Math.max(1, chart.categories.length);
  const seriesCount = Math.max(1, chart.series.length);
  if (horizontal) {
    const band = plotH / groups;
    chart.categories.forEach((_, group) => {
      chart.series.forEach((series, seriesIndex) => {
        const value = series.values[group] ?? 0;
        const barH = Math.max(2, (band * 0.7) / seriesCount);
        const y = pad + group * band + (band - barH * seriesCount) / 2 + seriesIndex * barH;
        const barW = Math.max(2, (value / max) * plotW);
        fillRect(rgba, width, pad, y, barW, barH - 2, palette[seriesIndex % palette.length]);
      });
    });
    return;
  }
  const band = plotW / groups;
  chart.categories.forEach((_, group) => {
    chart.series.forEach((series, seriesIndex) => {
      const value = series.values[group] ?? 0;
      const barW = Math.max(2, (band * 0.72) / seriesCount);
      const x = pad + group * band + (band - barW * seriesCount) / 2 + seriesIndex * barW;
      const barH = Math.max(2, (value / max) * plotH);
      fillRect(rgba, width, x, pad + plotH - barH, barW - 2, barH, palette[seriesIndex % palette.length]);
    });
  });
}

function drawLine(rgba: Uint8Array, width: number, height: number, chart: DocChart, palette: Rgb[]) {
  const pad = 36;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const max = Math.max(1, ...chart.series.flatMap((series) => series.values));
  const steps = Math.max(1, chart.categories.length - 1);
  chart.series.forEach((series, seriesIndex) => {
    const color = palette[seriesIndex % palette.length];
    for (let index = 0; index < series.values.length - 1; index += 1) {
      const x1 = pad + (index / steps) * plotW;
      const y1 = pad + plotH - ((series.values[index] ?? 0) / max) * plotH;
      const x2 = pad + ((index + 1) / steps) * plotW;
      const y2 = pad + plotH - ((series.values[index + 1] ?? 0) / max) * plotH;
      stroke(rgba, width, height, x1, y1, x2, y2, color);
    }
  });
}

function drawPie(rgba: Uint8Array, width: number, height: number, chart: DocChart, palette: Rgb[]) {
  const values = chart.series[0]?.values ?? [];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  let start = -Math.PI / 2;
  values.forEach((value, index) => {
    const sweep = (Math.max(0, value) / total) * Math.PI * 2;
    fillWedge(rgba, width, height, cx, cy, radius, start, start + sweep, palette[index % palette.length]);
    start += sweep;
  });
}

function stroke(rgba: Uint8Array, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: Rgb) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    fillRect(rgba, width, x1 + (x2 - x1) * t - 1.5, y1 + (y2 - y1) * t - 1.5, 3, 3, color);
  }
}

function fillWedge(
  rgba: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
  color: Rgb,
) {
  const left = Math.max(0, Math.floor(cx - radius));
  const top = Math.max(0, Math.floor(cy - radius));
  const right = Math.min(width, Math.ceil(cx + radius));
  const bottom = Math.min(height, Math.ceil(cy + radius));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      let angle = Math.atan2(dy, dx);
      if (angle < start) angle += Math.PI * 2;
      if (angle >= start && angle <= end) setPixel(rgba, width, x, y, color);
    }
  }
}

type Rgb = { r: number; g: number; b: number };

function hexRgb(value: string): Rgb {
  const n = Number.parseInt(value.replace("#", "").slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function fillRect(rgba: Uint8Array, width: number, x: number, y: number, w: number, h: number, color: Rgb) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w));
  const y1 = Math.ceil(y + h);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) setPixel(rgba, width, px, py, color);
  }
}

function setPixel(rgba: Uint8Array, width: number, x: number, y: number, color: Rgb) {
  if (x < 0 || y < 0) return;
  const index = (y * width + x) * 4;
  if (index < 0 || index + 3 >= rgba.length) return;
  rgba[index] = color.r;
  rgba[index + 1] = color.g;
  rgba[index + 2] = color.b;
  rgba[index + 3] = 255;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, row + 1);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const crcBuf = Buffer.concat([head.subarray(4), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([head, data, crc]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
