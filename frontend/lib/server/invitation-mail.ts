import { Resend } from "resend";
import { resendApiKey, resendFromEmail } from "@/lib/server/env";

type InviteMail = {
  to: string;
  prenom: string;
  nom: string;
  roleLabel: string;
  link: string;
};

export async function sendInvitationEmail(
  payload: InviteMail,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = resendApiKey();
  const fromRaw = resendFromEmail();
  if (!key || !fromRaw) {
    return { ok: false, message: "L'envoi d'e-mail n'est pas configuré (Resend)." };
  }

  const from = normalizeFrom(fromRaw);
  const resend = new Resend(key);
  const name = `${payload.prenom} ${payload.nom}`.trim();
  const { error } = await resend.emails.send({
    from,
    to: payload.to,
    subject: "Invitation à Ubuntu IA — configurez votre mot de passe",
    text: [
      `Bonjour ${name},`,
      "",
      `Vous êtes invité(e) à Ubuntu IA en tant que ${payload.roleLabel}.`,
      "Avant d'accéder à l'application, vous devez choisir votre mot de passe.",
      "",
      payload.link,
      "",
      "Ce lien expire dans 7 jours. Si vous n'attendiez pas ce message, ignorez-le.",
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
              <h1 style="margin:0 0 16px;font-size:22px;">Invitation à Ubuntu IA</h1>
              <p style="margin:0 0 12px;line-height:1.55;">Bonjour ${escapeHtml(name)},</p>
              <p style="margin:0 0 12px;line-height:1.55;">
                Vous êtes invité(e) en tant que <strong>${escapeHtml(payload.roleLabel)}</strong>.
                Vous devez d'abord choisir un mot de passe pour ouvrir votre espace.
              </p>
              <p style="margin:24px 0;">
                <a href="${escapeHtml(payload.link)}" style="display:inline-block;background:#17405B;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 22px;font-weight:600;">
                  Configurer mon mot de passe
                </a>
              </p>
              <p style="margin:0;font-size:13px;color:#4A6A7D;line-height:1.55;">
                Ce lien expire dans 7 jours. Si vous n'attendiez pas ce message, ignorez-le.
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
    console.error("[invite] resend", error);
    const detail = typeof error.message === "string" ? error.message.trim() : "";
    return { ok: false, message: resendFailureMessage(detail, from) };
  }
  return { ok: true };
}

function senderDomain(from: string): string {
  return from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? "de l'expéditeur";
}

function resendFailureMessage(detail: string, from: string): string {
  const domain = senderDomain(from);
  if (/not verified|verify your domain/i.test(detail)) {
    return `Le domaine ${domain} n'est pas vérifié dans Resend. Ajoutez-le dans Resend (Domains), publiez les enregistrements DNS, puis gardez une adresse de ce domaine dans RESEND_FROM_EMAIL.`;
  }
  if (/testing emails/i.test(detail)) {
    return "Sans domaine vérifié, Resend n'envoie les essais qu'à l'adresse du compte. Vérifiez un domaine, puis mettez à jour RESEND_FROM_EMAIL.";
  }
  if (/api.?key|unauthorized/i.test(detail)) {
    return "La clé Resend est refusée. Vérifiez RESEND_API_KEY.";
  }
  if (/domain|not allowed|from/i.test(detail)) {
    return `L'adresse d'expéditeur (${domain}) n'est pas autorisée. Vérifiez le domaine dans Resend, puis RESEND_FROM_EMAIL.`;
  }
  return "L'e-mail d'invitation n'a pas pu être envoyé.";
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
