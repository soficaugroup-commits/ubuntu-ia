import { createHash, randomBytes } from "crypto";

export function createInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
