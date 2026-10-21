import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "ubuntu-ia-connecteurs";

function keyFrom(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

/** Chiffre un secret (jeton OAuth) en AES-256-GCM. Le résultat ne contient pas la clé. */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

/** Déchiffre un secret produit par encryptSecret. Échoue si le sceau a été modifié. */
export function decryptSecret(payload: string, secret: string): string {
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < 29) throw new Error("Secret chiffré incomplet.");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
