import { Resend } from "resend";
import { resendApiKey, resendFromEmail } from "@/lib/server/env";

type ResetMail = {
  to: string;
  prenom: string;
  nom: string;
  link: string;
};

export async function sendPasswordResetEmail(
  payload: ResetMail,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = resendApiKey();
  const fromRaw = resendFromEmail();
  if (!key || !fromRaw) {
    return { ok: false, message: "L'envoi d'e-mail n'est pas configuré (Resend)." };
  }

  const from = normalizeFrom(fromRaw);
  const resend = new Resend(key);
  const name = `${payload.prenom} ${payload.nom}`.trim() || payload.to;
  const { error } = await resend.emails.send({
    from,
    to: payload.to,
    subject: "Réinitialisation de votre mot de passe Ubuntu IA",
    text: [
      `Bonjour ${name},`,
      "",
      "Une demande de réinitialisation de mot de passe a été faite pour votre compte Ubuntu IA.",
      "Ouvrez le lien ci-dessous pour choisir un nouveau mot de passe :",
      "",
      payload.link,
      "",
      "Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:32px;background:#E8EEF2;font-family:Poppins,Helvetica,Arial,sans-serif;color:#17405B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#E8EEF2;border-radius:28px;padding:32px;">
          <tr>
            <td>
              <p style="margin:0 0 8px;font-size:13px;">SOFICAU UBUNTU GROUP</p>
              <h1 style="margin:0 0 16px;font-size:22px;">Réinitialiser votre mot de passe</h1>
              <p style="margin:0 0 12px;line-height:1.55;">Bonjour ${escapeHtml(name)},</p>
              <p style="margin:0 0 12px;line-height:1.55;">
                Une demande de réinitialisation a été faite pour votre compte Ubuntu IA.
                Choisissez un nouveau mot de passe avec le bouton ci-dessous.
              </p>
              <p style="margin:24px 0;">
                <a href="${escapeHtml(payload.link)}" style="display:inline-block;background:#17405B;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 22px;font-weight:600;">
                  Choisir un nouveau mot de passe
                </a>
              </p>
              <p style="margin:0;font-size:13px;color:#4A6A7D;line-height:1.55;">
                Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  });

  if (error) {
    console.error("[password-reset] resend", error);
    const detail = typeof error.message === "string" ? error.message.trim() : "";
    if (/domain|verified|not allowed|from/i.test(detail)) {
      return {
        ok: false,
        message:
          "L'adresse d'expéditeur n'est pas autorisée. Vérifiez le domaine dans Resend, puis RESEND_FROM_EMAIL sur Netlify.",
      };
    }
    if (/api.?key|unauthorized|invalid/i.test(detail)) {
      return {
        ok: false,
        message: "La clé Resend est refusée. Vérifiez RESEND_API_KEY sur Netlify.",
      };
    }
    return { ok: false, message: "L'e-mail de réinitialisation n'a pas pu être envoyé." };
  }
  return { ok: true };
}

function normalizeFrom(value: string): string {
  const trimmed = value.trim();
  if (/<[^>]+>/.test(trimmed)) return trimmed;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `Ubuntu IA <${trimmed}>`;
  }
  return trimmed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
