import { describe, expect, it } from "vitest";
import { columnWidth, NUM_FMT, parseCellValue, parseNumber, splitTotalRow } from "@/lib/server/xlsx-cells";

describe("parseNumber", () => {
  it("lit les écritures française et anglaise", () => {
    expect(parseNumber("1 234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("abc")).toBeNull();
  });
});

describe("parseCellValue", () => {
  it("convertit pourcentages, dates, montants et années", () => {
    expect(parseCellValue("12,5 %")).toMatchObject({ value: 0.125, numFmt: NUM_FMT.percentDecimal, kind: "percent" });
    const date = parseCellValue("05/03/2026");
    expect(date.kind).toBe("date");
    expect((date.value as Date).toISOString().slice(0, 10)).toBe("2026-03-05");
    expect(parseCellValue("1 500 FCFA")).toMatchObject({ value: 1500, kind: "number" });
    expect(parseCellValue("2026")).toMatchObject({ value: 2026, numFmt: NUM_FMT.year });
    expect(parseCellValue("Abidjan")).toMatchObject({ value: "Abidjan", kind: "text" });
  });
});

describe("splitTotalRow", () => {
  it("retire la ligne Total recopiée", () => {
    const { data, total } = splitTotalRow([["A", "1"], ["B", "2"], ["Total", "4"]]);
    expect(data).toHaveLength(2);
    expect(total?.[1]).toBe("4");
  });
});

describe("columnWidth", () => {
  it("borne la largeur", () => {
    expect(columnWidth(["a"])).toBe(10);
    expect(columnWidth(["x".repeat(200)])).toBe(50);
  });
});
