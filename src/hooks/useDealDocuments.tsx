import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { prepareUpload, gunzipToBlob } from "@/lib/documentCompression";

export type DealDocumentKind = "signed_contract" | "po" | "rfq_submitted" | "proposal" | "other";

export interface DealDocument {
  id: string;
  deal_id: string;
  kind: DealDocumentKind;
  file_path: string | null;
  source_type?: "file" | "link" | null;
  external_url?: string | null;
  file_name: string;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
  is_compressed?: boolean | null;
  original_mime?: string | null;
}

const BUCKET = "deal-documents";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
]);

const inferOriginalMime = (doc: DealDocument) => {
  if (doc.original_mime) return doc.original_mime;
  const storedMime = doc.mime_type || "";
  if (storedMime && storedMime !== "application/gzip") return storedMime;
  const name = doc.file_name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (name.endsWith(".doc")) return "application/msword";
  return storedMime || "application/octet-stream";
};

const isStoredCompressed = (doc: DealDocument) =>
  Boolean(doc.is_compressed) ||
  doc.mime_type === "application/gzip" ||
  (doc.file_path ?? "").toLowerCase().endsWith(".gz");

export const isLinkDoc = (doc: DealDocument) =>
  doc.source_type === "link" || (!doc.file_path && !!doc.external_url);

export const useDealDocuments = (dealId: string | undefined) => {
  const [docs, setDocs] = useState<DealDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
    };
  }, []);

  const fetchDocs = useCallback(async () => {
    if (!dealId) {
      setDocs([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("deal_documents" as any)
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error("Failed to load deal documents", error);
      toast.error("Could not load deal documents");
      return;
    }
    setDocs((data as unknown as DealDocument[]) ?? []);
  }, [dealId]);

  useEffect(() => {
    void fetchDocs();
  }, [fetchDocs]);

  const upload = useCallback(
    async (kind: DealDocumentKind, file: File) => {
      if (!dealId) {
        toast.error("Save the deal before uploading documents");
        return null;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error("File exceeds the 10MB limit");
        return null;
      }
      if (file.type && !ACCEPTED_MIME.has(file.type)) {
        toast.error("Unsupported file type. Use PDF, Word, PNG or JPG.");
        return null;
      }

      setBusy(true);
      try {
        const prepared = await prepareUpload(file);

        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id ?? null;

        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${dealId}/${kind}/${crypto.randomUUID()}-${safe}${prepared.storedExt}`;

        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, prepared.blob, {
            contentType: prepared.storedMime,
            upsert: false,
          });
        if (upErr) throw upErr;

        const { data: row, error: insErr } = await supabase
          .from("deal_documents" as any)
          .insert({
            deal_id: dealId,
            kind,
            file_path: path,
            file_name: file.name,
            size_bytes: prepared.storedSize,
            mime_type: prepared.storedMime,
            uploaded_by: uid,
            is_compressed: prepared.isCompressed,
            original_mime: prepared.originalMime,
          })
          .select("*")
          .single();
        if (insErr) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw insErr;
        }

        const saved = prepared.originalSize - prepared.storedSize;
        if (saved > 1024) {
          const pct = Math.round((saved / prepared.originalSize) * 100);
          toast.success(`Document uploaded (saved ${pct}% storage)`);
        } else {
          toast.success("Document uploaded");
        }
        await fetchDocs();
        return row as unknown as DealDocument;
      } catch (e: any) {
        console.error("Upload failed", e);
        toast.error(e?.message ?? "Upload failed");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [dealId, fetchDocs]
  );

  const addLink = useCallback(
    async (kind: DealDocumentKind, url: string, label?: string) => {
      if (!dealId) {
        toast.error("Save the deal before adding document links");
        return null;
      }
      const trimmed = url.trim();
      let normalized = trimmed;
      if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
      try {
        // eslint-disable-next-line no-new
        new URL(normalized);
      } catch {
        toast.error("Enter a valid document link (URL)");
        return null;
      }

      setBusy(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id ?? null;
        const { data: row, error } = await supabase
          .from("deal_documents" as any)
          .insert({
            deal_id: dealId,
            kind,
            source_type: "link",
            external_url: normalized,
            file_path: null,
            file_name: (label?.trim() || normalized).slice(0, 255),
            uploaded_by: uid,
          })
          .select("*")
          .single();
        if (error) throw error;
        toast.success("Document link added");
        await fetchDocs();
        return row as unknown as DealDocument;
      } catch (e: any) {
        console.error("Add link failed", e);
        toast.error(e?.message ?? "Could not add document link");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [dealId, fetchDocs]
  );

  const remove = useCallback(
    async (doc: DealDocument) => {
      setBusy(true);
      try {
        if (!isLinkDoc(doc) && doc.file_path) {
          const { error: stErr } = await supabase.storage
            .from(BUCKET)
            .remove([doc.file_path]);
          if (stErr) throw stErr;
        }
        const { error: delErr } = await supabase
          .from("deal_documents" as any)
          .delete()
          .eq("id", doc.id);
        if (delErr) throw delErr;
        toast.success(isLinkDoc(doc) ? "Link removed" : "Document removed");
        await fetchDocs();
      } catch (e: any) {
        console.error("Delete failed", e);
        toast.error(e?.message ?? "Delete failed");
      } finally {
        setBusy(false);
      }
    },
    [fetchDocs]
  );

  const getSignedUrl = useCallback(async (doc: DealDocument) => {
    if (isLinkDoc(doc) || !doc.file_path) return doc.external_url ?? null;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path, 60 * 10);
    if (error) {
      toast.error("Could not generate download link");
      return null;
    }
    return data.signedUrl;
  }, []);

  /** Returns a viewable blob URL for the document — gunzips compressed files and re-types blobs so browsers preview inline. */
  const getViewableUrl = useCallback(
    async (doc: DealDocument): Promise<{ url: string; mime: string; blob: Blob } | null> => {
      const signed = await getSignedUrl(doc);
      if (!signed) return null;
      const mime = inferOriginalMime(doc);
      try {
        const resp = await fetch(signed);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const raw = await resp.blob();
        const decoded = isStoredCompressed(doc) ? await gunzipToBlob(raw, mime) : raw;
        // Force the correct mime so iframes preview PDFs inline instead of being blocked/downloaded.
        const typed = decoded.type === mime ? decoded : new Blob([decoded], { type: mime });
        const url = URL.createObjectURL(typed);
        objectUrlsRef.current.push(url);
        return { url, mime, blob: typed };
      } catch (e) {
        console.error("Failed to load document", e);
        toast.error("Could not open document");
        return null;
      }
    },
    [getSignedUrl],
  );

  const revokeObjectUrl = useCallback((url: string) => {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== url);
    }
  }, []);

  const hasKind = (kind: DealDocumentKind) =>
    docs.some((d) => d.kind === kind);

  return {
    docs,
    loading,
    busy,
    upload,
    addLink,
    remove,
    getSignedUrl,
    getViewableUrl,
    revokeObjectUrl,
    hasKind,
    refresh: fetchDocs,
  };
};
