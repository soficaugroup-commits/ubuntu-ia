/**
 * Conversion des cellules texte (rédigées par le modèle) en valeurs Excel typées.
 * Les formats sont des codes Excel invariants : Excel les affiche selon la langue du poste
 * (`#,##0.00` devient « 1 234,56 » en français).
 */
export type CellValue = {
  value: string | number | Date;
  numFmt?: string;
  kind: "text" | "number" | "percent" | "date";
};

export const NUM_FMT = {
  integer: "#,##0",
  decimal: "#,##0.00",
  percent: "0%",
  percentDecimal: "0.0%",
  date: "dd/mm/yyyy",
  year: "0",
} as const;

const CURRENCIES: Record<string, string> = {
  "€": '"€"',
  eur: '"€"',
  fcfa: '"FCFA"',
  xof: '"FCFA"',
  xaf: '"FCFA"',
  $: '"$"',
  usd: '"$"',
};

export function parseCellValue(raw: string): CellValue {
  const text = raw.replace(/[\u00a0\u202f]/g, " ").trim();
  if (!text) return { value: "", kind: "text" };

  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (date) {
    const [day, month, year] = [Number(date[1]), Number(date[2]), Number(date[3])];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { value: new Date(Date.UTC(year, month - 1, day)), numFmt: NUM_FMT.date, kind: "date" };
    }
  }

  const percent = /^([-+]?[\d\s.,]+)\s?%$/.exec(text);
  if (percent) {
    const number = parseNumber(percent[1]);
    if (number !== null) {
      const decimals = !Number.isInteger(number);
      return {
        value: number / 100,
        numFmt: decimals ? NUM_FMT.percentDecimal : NUM_FMT.percent,
        kind: "percent",
      };
    }
  }

  const money = /^([-+]?[\d\s.,]+)\s?(€|eur|fcfa|xof|xaf|\$|usd)$/i.exec(text) ?? /^(\$)\s?([-+]?[\d\s.,]+)$/.exec(text);
  if (money) {
    const digits = money[1] === "$" ? money[2] : money[1];
    const unit = (money[1] === "$" ? "$" : money[2]).toLowerCase();
    const number = parseNumber(digits);
    if (number !== null) {
      const base = Number.isInteger(number) ? NUM_FMT.integer : NUM_FMT.decimal;
      return { value: number, numFmt: `${base} ${CURRENCIES[unit] ?? ""}`.trim(), kind: "number" };
    }
  }

  const number = parseNumber(text);
  if (number !== null) {
    if (Number.isInteger(number) && number >= 1900 && number <= 2100 && /^\d{4}$/.test(text)) {
      return { value: number, numFmt: NUM_FMT.year, kind: "number" };
    }
    return { value: number, numFmt: Number.isInteger(number) ? NUM_FMT.integer : NUM_FMT.decimal, kind: "number" };
  }
  return { value: text, kind: "text" };
}

/**
 * Lit un nombre écrit à la française (« 1 234,56 ») ou à l'anglaise (« 1,234.56 »).
 * Retourne null si le texte n'est pas un nombre pur.
 */
export function parseNumber(raw: string): number | null {
  let text = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (!/^[-+]?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    text = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const parts = text.split(",");
    text = parts.length > 2 ? parts.join("") : text.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = text.split(".");
    if (parts.length > 2) text = parts.join("");
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const TOTAL_LABEL = /^(total|totaux|sous-total|total général|total general|ensemble)\b/i;

export function isTotalLabel(value: string): boolean {
  return TOTAL_LABEL.test(value.trim());
}

/** Retire la dernière ligne « Total » recopiée : elle sera remplacée par une vraie formule. */
export function splitTotalRow(rows: string[][]): { data: string[][]; total?: string[] } {
  const last = rows[rows.length - 1];
  if (rows.length >= 2 && last && isTotalLabel(last[0] ?? "")) {
    return { data: rows.slice(0, -1), total: last };
  }
  return { data: rows };
}

/** Largeur de colonne (en caractères) ajustée au contenu, bornée pour rester imprimable. */
export function columnWidth(values: string[], min = 10, max = 50): number {
  const longest = values.reduce((best, value) => Math.max(best, value.length), 0);
  return Math.min(max, Math.max(min, Math.ceil(longest * 1.1) + 2));
}
