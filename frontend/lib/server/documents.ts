import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { INDEXABLE_EXTENSIONS } from "@/lib/upload-files";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { documentsStorageDir, queueReingest } from "@/lib/server/ingest-worker";
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
    .select(
      "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur",
    )
    .order("date_ajout", { ascending: false });
  if (error) {
    throw new Error("La liste des documents n'a pas pu être chargée.");
  }
  return (data as DocumentRow[]).map(mapDocument);
}

function fileExtension(name: string): string | null {
  const ext = path.extname(name).toLowerCase();
  return (INDEXABLE_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
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
    .select(
      "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur",
    )
    .single();
  if (error || !data) {
    throw new Error("Le document n'a pas pu être enregistré.");
  }

  const stored = path.join(documentsStorageDir(), `${data.id}${ext}`);
  try {
    await mkdir(documentsStorageDir(), { recursive: true });
    await writeFile(stored, Buffer.from(await file.arrayBuffer()));
    const updated = await admin
      .from("documents")
      .update({ chemin_stockage: stored })
      .eq("id", data.id)
      .select(
        "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur",
      )
      .single();
    queueReingest(data.id);
    return mapDocument((updated.data as DocumentRow) ?? (data as DocumentRow));
  } catch (exc) {
    await admin
      .from("documents")
      .update({
        statut_indexation: "erreur",
        message_erreur: "Le fichier n'a pas pu être enregistré pour indexation.",
      })
      .eq("id", data.id);
    throw exc;
  }
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
    .select(
      "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur",
    )
    .single();
  if (error || !data) {
    throw new Error("La page n'a pas pu être enregistrée.");
  }
  queueReingest(data.id);
  return mapDocument(data as DocumentRow);
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
    .select(
      "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur",
    )
    .single();
  if (error || !data) {
    throw new IngestUserError("Document introuvable.");
  }
  queueReingest(id);
  return mapDocument(data as DocumentRow);
}

export async function deleteStoredDocument(id: string): Promise<KnowledgeDocument> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("documents")
    .select(
      "id, titre, categorie, type_source, url_source, date_ajout, chemin_stockage, statut_indexation, message_erreur",
    )
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

  if (stored) {
    const root = path.resolve(documentsStorageDir());
    const resolved = path.resolve(stored);
    if (resolved.startsWith(root)) {
      await unlink(resolved).catch(() => undefined);
    }
  }
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
