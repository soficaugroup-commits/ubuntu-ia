import { chunkText } from "@/lib/server/chunk-text";
import { embedTexts } from "@/lib/server/embed-texts";
import { extractFromBuffer, extractFromUrl } from "@/lib/server/extract-content";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const DOCUMENTS_BUCKET = "documents";

export function storageObjectPath(documentId: string, filename: string): string {
  const ext = filename.includes(".")
    ? `.${filename.split(".").pop()?.toLowerCase()}`
    : "";
  return `${documentId}${ext}`;
}

export async function uploadDocumentFile(
  documentId: string,
  file: File,
): Promise<string> {
  const path = storageObjectPath(documentId, file.name);
  const { error } = await supabaseAdmin()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (error) {
    throw new Error(`Le fichier n'a pas pu être stocké : ${error.message}`);
  }
  return path;
}

export async function deleteStoredFile(path: string | null): Promise<void> {
  if (!path || path.includes(":\\") || path.startsWith("/")) return;
  await supabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove([path]);
}

export async function indexTextInto(documentId: string, text: string): Promise<void> {
  const client = supabaseAdmin();
  await client.from("document_chunks").delete().eq("document_id", documentId);
  const segments = chunkText(text);
  if (!segments.length) {
    throw new Error("Le document n'a produit aucun segment.");
  }
  const vectors = await embedTexts(segments.map((segment) => segment.contenu));
  const { error } = await client.from("document_chunks").insert(
    segments.map((segment, index) => ({
      document_id: documentId,
      contenu: segment.contenu,
      embedding: vectors[index],
      position_document: segment.position_document,
    })),
  );
  if (error) {
    throw new Error(`Les extraits n'ont pas pu être enregistrés : ${error.message}`);
  }
  const { error: updateError } = await client
    .from("documents")
    .update({ statut_indexation: "termine", message_erreur: null })
    .eq("id", documentId);
  if (updateError) {
    throw new Error("Le statut d'indexation n'a pas pu être mis à jour.");
  }
}

export async function indexStoredFile(
  documentId: string,
  storagePath: string,
  filename: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin()
    .storage.from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error("Le fichier source n'est plus disponible dans le stockage.");
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const text = await extractFromBuffer(buffer, filename);
  await indexTextInto(documentId, text);
}

export async function indexUploadedFile(
  documentId: string,
  file: File,
): Promise<void> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = await extractFromBuffer(buffer, file.name);
  await indexTextInto(documentId, text);
}

export async function indexRemoteUrl(documentId: string, url: string): Promise<void> {
  const { text } = await extractFromUrl(url);
  await indexTextInto(documentId, text);
}

export async function markDocumentError(
  documentId: string,
  message: string,
): Promise<void> {
  await supabaseAdmin()
    .from("documents")
    .update({ statut_indexation: "erreur", message_erreur: message })
    .eq("id", documentId);
}
