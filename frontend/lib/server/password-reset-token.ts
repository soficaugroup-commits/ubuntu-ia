import { createHash, randomBytes } from "crypto";

export function createPasswordResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashPasswordResetToken(token) };
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Lien court : 1 heure. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
