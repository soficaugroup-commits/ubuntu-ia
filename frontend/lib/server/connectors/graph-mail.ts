export type MailHit = { id: string; subject: string; from: string; preview: string };

export type GraphMail = {
  search(token: string, query: string): Promise<MailHit[]>;
  read(token: string, id: string): Promise<{ subject: string; from: string; body: string }>;
  createDraft(token: string, draft: { to: string; subject: string; body: string }): Promise<{ id: string }>;
  sendDraft(token: string, draftId: string): Promise<void>;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function graphMail(fetchImpl: Fetcher = fetch): GraphMail {
  return {
    async search(token, query) {
      const safe = query.replace(/"/g, "").slice(0, 120);
      const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(`"${safe}"`)}&$top=5`;
      const payload = await graphGet(fetchImpl, token, url);
      const value = Array.isArray(payload.value) ? payload.value : [];
      return value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { id?: unknown; subject?: unknown; bodyPreview?: unknown; from?: { emailAddress?: { address?: unknown } } };
        if (typeof row.id !== "string") return [];
        return [
          {
            id: row.id,
            subject: typeof row.subject === "string" ? row.subject : "(sans objet)",
            from: typeof row.from?.emailAddress?.address === "string" ? row.from.emailAddress.address : "",
            preview: typeof row.bodyPreview === "string" ? row.bodyPreview : "",
          },
        ];
      });
    },
    async read(token, id) {
      const payload = await graphGet(fetchImpl, token, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}`);
      const body = payload.body as { content?: unknown } | undefined;
      const from = payload.from as { emailAddress?: { address?: unknown } } | undefined;
      return {
        subject: typeof payload.subject === "string" ? payload.subject : "",
        from: typeof from?.emailAddress?.address === "string" ? from.emailAddress.address : "",
        body: typeof body?.content === "string" ? body.content : "",
      };
    },
    async createDraft(token, draft) {
      const response = await fetchImpl("https://graph.microsoft.com/v1.0/me/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: draft.subject,
          body: { contentType: "Text", content: draft.body },
          toRecipients: [{ emailAddress: { address: draft.to } }],
        }),
      });
      const payload = await readJson(response);
      if (!response.ok || typeof payload.id !== "string") {
        throw new Error("Le brouillon Outlook n'a pas pu être créé.");
      }
      return { id: payload.id };
    },
    async sendDraft(token, draftId) {
      const response = await fetchImpl(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/send`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok && response.status !== 202) {
        throw new Error("L'envoi du brouillon Outlook a échoué.");
      }
    },
  };
}

async function graphGet(fetchImpl: Fetcher, token: string, url: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await readJson(response);
  if (!response.ok) throw new Error("La lecture Outlook a échoué.");
  return payload;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}
