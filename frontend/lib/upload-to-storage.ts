import { supabaseBrowser } from "@/lib/supabase";
import { fileExtension } from "@/lib/upload-files";

export const DOCUMENTS_BUCKET = "documents";

export { fileExtension };

export async function uploadKnowledgeFile(
  file: File,
): Promise<{ ok: true; storagePath: string } | { ok: false; message: string }> {
  const supabase = supabaseBrowser();
  if (!supabase) {
    return { ok: false, message: "Le stockage n'est pas configuré." };
  }

  const ext = fileExtension(file.name);
  if (!ext) {
    return {
      ok: false,
      message:
        "Ce format n'est pas accepté. Envoyez un PDF, Word, Excel, PowerPoint, CSV, texte, image ou infographie.",
    };
  }

  const storagePath = `${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    return {
      ok: false,
      message: `Le fichier n'a pas pu être stocké : ${error.message}`,
    };
  }

  return { ok: true, storagePath };
}
