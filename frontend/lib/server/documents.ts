import { fileExtension } from "@/lib/upload-files";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import {
  deleteStoredFile,
  indexRemoteUrl,
  indexStoredFile,
  indexUploadedFile,
  markDocumentError,
  uploadDocumentFile,
} from "@/lib/server/index-document";
import type { KnowledgeDocument } from "@/lib/types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

type DocumentRow = {
  id: string;
  titre: string;
  categorie: string | null;
  type_source: "fichier" | "url";
  url_source: string | null;
  date_ajout: string;
  chemin_stockage: string | null;
  statut_indexation: KnowledgeDocument["statut_indexation"];
  message_erreur: string | null;
};

const DOCUMENT_COLUMNS =
  "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur";

export function mapDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    titre: row.titre,
    categorie: row.categorie ?? "",
    type_source: row.type_source,
    url_source: row.url_source,
    date_ajout: row.date_ajout,
    statut_indexation: row.statut_indexation,
    message_erreur: row.message_erreur,
  };
}

export async function listDocuments(): Promise<KnowledgeDocument[]> {
  const { data, error } = await supabaseAdmin()
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .order("date_ajout", { ascending: false });
  if (error) {
    throw new Error("La liste des documents n'a pas pu être chargée.");
  }
  return (data as DocumentRow[]).map(mapDocument);
}

const STORED_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{2,8}$/i;

function assertStoredPath(path: string): string {
  const trimmed = path.trim();
  if (!STORED_PATH.test(trimmed)) {
    throw new IngestUserError("Le fichier stocké est introuvable ou invalide.");
  }
  return trimmed;
}

async function fetchDocument(id: string): Promise<DocumentRow> {
  const { data, error } = await supabaseAdmin()
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", id)
    .single();
  if (error || !data) {
    throw new IngestUserError("Document introuvable.");
  }
  return data as DocumentRow;
}

export async function createFileDocument(
  file: File,
  categorie: string,
): Promise<KnowledgeDocument> {
  const ext = fileExtension(file.name);
  if (!ext) {
    throw new IngestUserError(
      "Ce format n'est pas accepté. Envoyez un PDF, Word, Excel, PowerPoint, CSV, texte, image ou infographie.",
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new IngestUserError(
      "Le fichier dépasse 20 Mo. Réduisez-le ou découpez-le avant de l'envoyer.",
    );
  }

  const titre = file.name.replace(/\.[^.]+$/, "") || file.name;
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("documents")
    .insert({
      titre,
      categorie: categorie || null,
      type_source: "fichier",
      statut_indexation: "en_cours",
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error("Le document n'a pas pu être enregistré.");
  }

  try {
    const stored = await uploadDocumentFile(data.id, file);
    await admin.from("documents").update({ chemin_stockage: stored }).eq("id", data.id);
    await indexUploadedFile(data.id, file);
  } catch (exc) {
    const message =
      exc instanceof Error
        ? exc.message
        : "L'indexation n'a pas pu aboutir.";
    await markDocumentError(data.id, message);
  }

  return mapDocument(await fetchDocument(data.id));
}

export async function createStoredFileDocument(
  storagePath: string,
  filename: string,
  categorie: string,
): Promise<KnowledgeDocument> {
  const stored = assertStoredPath(storagePath);
  const ext = fileExtension(filename) || fileExtension(stored);
  if (!ext) {
    throw new IngestUserError(
      "Ce format n'est pas accepté. Envoyez un PDF, Word, Excel, PowerPoint, CSV, texte, image ou infographie.",
    );
  }

  const titre = filename.replace(/\.[^.]+$/, "") || filename;
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("documents")
    .insert({
      titre,
      categorie: categorie || null,
      type_source: "fichier",
      chemin_stockage: stored,
      statut_indexation: "en_cours",
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error("Le document n'a pas pu être enregistré.");
  }

  try {
    await indexStoredFile(data.id, stored, filename);
  } catch (exc) {
    const message =
      exc instanceof Error ? exc.message : "L'indexation n'a pas pu aboutir.";
    await markDocumentError(data.id, message);
  }

  return mapDocument(await fetchDocument(data.id));
}

export async function createUrlDocument(
  url: string,
  categorie: string,
): Promise<KnowledgeDocument> {
  const { data, error } = await supabaseAdmin()
    .from("documents")
    .insert({
      titre: titleFromUrl(url),
      categorie: categorie || null,
      type_source: "url",
      url_source: url,
      statut_indexation: "en_cours",
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error("La page n'a pas pu être enregistrée.");
  }

  try {
    await indexRemoteUrl(data.id, url);
  } catch (exc) {
    const message =
      exc instanceof Error ? exc.message : "L'indexation de la page n'a pas pu aboutir.";
    await markDocumentError(data.id, message);
  }

  return mapDocument(await fetchDocument(data.id));
}

export async function reingestAllDocuments(): Promise<KnowledgeDocument[]> {
  const documents = await listDocuments();
  const queued: KnowledgeDocument[] = [];
  for (const document of documents) {
    queued.push(await reingestDocument(document.id));
  }
  return queued;
}

export async function reingestDocument(id: string): Promise<KnowledgeDocument> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("documents")
    .update({ statut_indexation: "en_cours", message_erreur: null })
    .eq("id", id)
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    throw new IngestUserError("Document introuvable.");
  }
  const document = data as DocumentRow;

  try {
    if (document.type_source === "url") {
      if (!document.url_source) {
        throw new Error("Cette page n'a pas d'adresse à relire.");
      }
      await indexRemoteUrl(id, document.url_source);
    } else {
      const storage = document.chemin_stockage;
      if (!storage || storage.includes(":\\") || storage.startsWith("/")) {
        throw new Error(
          "Ce fichier a été indexé hors production. Renvoyez-le pour l'enregistrer dans le stockage.",
        );
      }
      await indexStoredFile(id, storage, storage);
    }
  } catch (exc) {
    const message =
      exc instanceof Error ? exc.message : "La réindexation n'a pas pu aboutir.";
    await markDocumentError(id, message);
  }

  return mapDocument(await fetchDocument(id));
}

export async function deleteStoredDocument(id: string): Promise<KnowledgeDocument> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new IngestUserError("Document introuvable.");
  }

  const stored = (data as DocumentRow).chemin_stockage;
  const { error: deleteError } = await admin.from("documents").delete().eq("id", id);
  if (deleteError) {
    throw new Error("Le document n'a pas pu être supprimé.");
  }

  await deleteStoredFile(stored);
  return mapDocument(data as DocumentRow);
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname.replace(/\/$/, "");
    return pathName
      ? `${parsed.hostname} — ${pathName.slice(1)}`
      : parsed.hostname;
  } catch {
    return url;
  }
}

export class IngestUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestUserError";
  }
}
