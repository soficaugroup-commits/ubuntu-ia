import "server-only";
import { officeWorkerEnabled } from "@/lib/server/office-validate";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const GENERATED_BUCKET = "generated-files";

const OFFICE_KINDS: Record<string, string[]> = {
  docx: ["validate_ooxml"],
  pptx: ["validate_ooxml"],
  xlsx: ["validate_ooxml", "xlsx_recalc"],
};

export async function storeGeneratedFile(input: {
  userId?: string;
  name: string;
  mime: string;
  format: string;
  bytes: Buffer;
}): Promise<string | null> {
  if (!input.userId) return null;
  const path = `${input.userId}/${crypto.randomUUID()}/${input.name}`;
  try {
    const client = supabaseAdmin();
    const { error } = await client.storage.from(GENERATED_BUCKET).upload(path, input.bytes, {
      contentType: input.mime,
      upsert: false,
    });
    if (error) return null;
    const signed = await client.storage.from(GENERATED_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    const kinds = officeWorkerEnabled() ? OFFICE_KINDS[input.format] ?? [] : [];
    if (kinds.length) {
      const { error: jobError } = await client.from("office_jobs").insert(
        kinds.map((kind) => ({
          user_id: input.userId,
          kind,
          input_path: path,
          status: "queued",
          payload: { source: "chat", format: input.format, bucket: GENERATED_BUCKET },
        })),
      );
      if (jobError) console.error("[generated-files] office_jobs", jobError.message);
    }
    return signed.data?.signedUrl ?? null;
  } catch (error) {
    console.error("[generated-files] stockage", error);
    return null;
  }
}
