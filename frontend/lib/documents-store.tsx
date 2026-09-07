"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { adminDelete, adminPost, adminPostForm } from "@/lib/admin-api";
import { defaultCategories, validateNewCategory } from "@/lib/categories";
import { listKnowledgeFromSession } from "@/lib/knowledge-list";
import { useSession } from "@/lib/session";
import {
  INDEXABLE_EXTENSIONS,
  INDEXABLE_MIME_TYPES,
} from "@/lib/upload-files";
import type {
  DocumentCategory,
  KnowledgeCategory,
  KnowledgeDocument,
} from "@/lib/types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const GENERIC_TYPES = new Set(["", "application/octet-stream"]);

type AddResult<TOk, TCode extends string> =
  | { ok: true; document: TOk }
  | { ok: false; code: TCode; message?: string };

type DocumentsContextValue = {
  documents: KnowledgeDocument[];
  categories: KnowledgeCategory[];
  hasEverHadDocuments: boolean;
  loadState: "loading" | "ready" | "error";
  reload: () => Promise<void>;
  addFile: (
    file: File,
    categorie: DocumentCategory,
  ) => Promise<AddResult<KnowledgeDocument, "fileType" | "fileSize" | "ingest">>;
  addUrl: (
    url: string,
    categorie: DocumentCategory,
  ) => Promise<AddResult<KnowledgeDocument, "urlRequired" | "urlFormat" | "ingest">>;
  addCategory: (
    label: string,
  ) => Promise<
    | { ok: true; category: KnowledgeCategory }
    | {
        ok: false;
        code: "required" | "invalid" | "duplicate" | "unavailable";
        message?: string;
      }
  >;
  retryIndex: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  retryAll: () => Promise<{ ok: true; count: number } | { ok: false; message: string }>;
  remove: (
    id: string,
  ) => Promise<{ ok: true; document: KnowledgeDocument } | { ok: false; message: string }>;
};

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

function hasAllowedType(file: File): boolean {
  const name = file.name.toLowerCase();
  const extOk = INDEXABLE_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (extOk) return true;
  return Boolean(file.type) && !GENERIC_TYPES.has(file.type)
    && (INDEXABLE_MIME_TYPES as readonly string[]).includes(file.type);
}

export function validateUploadFile(
  file: File,
): { ok: true } | { ok: false; code: "fileType" | "fileSize" } {
  if (!hasAllowedType(file)) return { ok: false, code: "fileType" };
  if (file.size > MAX_FILE_BYTES) return { ok: false, code: "fileSize" };
  return { ok: true };
}

export function parseDocumentUrl(
  url: string,
): { ok: true; href: string } | { ok: false; code: "urlRequired" | "urlFormat" } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, code: "urlRequired" };
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, code: "urlFormat" };
    }
    return { ok: true, href: parsed.toString() };
  } catch {
    return { ok: false, code: "urlFormat" };
  }
}

function upsertDocument(
  current: KnowledgeDocument[],
  document: KnowledgeDocument,
): KnowledgeDocument[] {
  return [document, ...current.filter((item) => item.id !== document.id)];
}

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const { user, hydrated } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>(defaultCategories);
  const [hasEverHadDocuments, setHasEverHadDocuments] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  const refresh = useCallback(async (reportError = true) => {
    const result = await listKnowledgeFromSession();
    if (!result.ok) {
      if (reportError) setLoadState("error");
      return;
    }
    setDocuments(result.documents);
    setCategories(result.categories);
    if (result.documents.length > 0) setHasEverHadDocuments(true);
    setLoadState("ready");
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      if (!user || user.role !== "administrateur") {
        setDocuments([]);
        setLoadState("ready");
        return;
      }
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, refresh, user]);

  const reload = useCallback(async () => {
    setLoadState("loading");
    await refresh();
  }, [refresh]);

  const busy = documents.some(
    (document) =>
      document.statut_indexation === "en_cours" ||
      document.statut_indexation === "en_attente",
  );

  useEffect(() => {
    if (loadState !== "ready" || !busy) return;
    const timer = window.setInterval(() => {
      void refresh(false);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [busy, loadState, refresh]);

  const addFile = useCallback<DocumentsContextValue["addFile"]>(
    async (file, categorie) => {
      const check = validateUploadFile(file);
      if (!check.ok) return check;

      const form = new FormData();
      form.append("file", file);
      form.append("categorie", categorie);
      const result = await adminPostForm<{ document: KnowledgeDocument }>(
        "/api/documents",
        form,
      );
      if (!result.ok) {
        return { ok: false, code: "ingest", message: result.error };
      }
      setHasEverHadDocuments(true);
      setDocuments((current) => upsertDocument(current, result.data.document));
      return { ok: true, document: result.data.document };
    },
    [],
  );

  const addUrl = useCallback<DocumentsContextValue["addUrl"]>(
    async (url, categorie) => {
      const parsed = parseDocumentUrl(url);
      if (!parsed.ok) return parsed;

      const result = await adminPost<{ document: KnowledgeDocument }>("/api/documents", {
        url: parsed.href,
        categorie,
      });
      if (!result.ok) {
        return { ok: false, code: "ingest", message: result.error };
      }
      setHasEverHadDocuments(true);
      setDocuments((current) => upsertDocument(current, result.data.document));
      return { ok: true, document: result.data.document };
    },
    [],
  );

  const retryIndex = useCallback<DocumentsContextValue["retryIndex"]>(async (id) => {
    const result = await adminPost<{ document: KnowledgeDocument }>(
      `/api/documents/${id}/reingest`,
      {},
    );
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    setDocuments((current) =>
      current.map((doc) => (doc.id === id ? result.data.document : doc)),
    );
    return { ok: true };
  }, []);

  const retryAll = useCallback<DocumentsContextValue["retryAll"]>(async () => {
    const result = await adminPost<{ documents: KnowledgeDocument[]; count: number }>(
      "/api/documents/reingest-all",
      {},
    );
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    setDocuments(result.data.documents);
    return { ok: true, count: result.data.count };
  }, []);

  const remove = useCallback<DocumentsContextValue["remove"]>(async (id) => {
    const result = await adminDelete<{ document: KnowledgeDocument }>(
      `/api/documents/${id}`,
    );
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    setDocuments((current) => current.filter((doc) => doc.id !== id));
    return { ok: true, document: result.data.document };
  }, []);

  const addCategory = useCallback<DocumentsContextValue["addCategory"]>(
    async (label) => {
      const parsed = validateNewCategory(label, categories);
      if (!parsed.ok) return parsed;

      const result = await adminPost<{ category: KnowledgeCategory }>(
        "/api/documents/categories",
        { label: parsed.category.label },
      );
      if (!result.ok) {
        const code =
          result.field === "required" ||
          result.field === "invalid" ||
          result.field === "duplicate"
            ? result.field
            : "unavailable";
        return { ok: false, code, message: result.error };
      }

      setCategories((current) =>
        [...current.filter((item) => item.id !== result.data.category.id), result.data.category]
          .sort((a, b) => a.label.localeCompare(b.label, "fr")),
      );
      return { ok: true, category: result.data.category };
    },
    [categories],
  );

  const value = useMemo(
    () => ({
      documents,
      categories,
      hasEverHadDocuments,
      loadState,
      reload,
      addFile,
      addUrl,
      addCategory,
      retryIndex,
      retryAll,
      remove,
    }),
    [
      documents,
      categories,
      hasEverHadDocuments,
      loadState,
      reload,
      addFile,
      addUrl,
      addCategory,
      retryIndex,
      retryAll,
      remove,
    ],
  );

  return (
    <DocumentsContext.Provider value={value}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx) {
    throw new Error("useDocuments must be used within DocumentsProvider");
  }
  return ctx;
}
