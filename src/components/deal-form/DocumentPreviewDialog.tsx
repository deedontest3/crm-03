import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useDealDocuments, type DealDocument } from "@/hooks/useDealDocuments";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AppLoader } from "@/components/ui/loader";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface DocumentPreviewDialogProps {
  doc: DealDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getViewableUrl: ReturnType<typeof useDealDocuments>["getViewableUrl"];
  revokeObjectUrl: ReturnType<typeof useDealDocuments>["revokeObjectUrl"];
}

export const DocumentPreviewDialog = ({
  doc,
  open,
  onOpenChange,
  getViewableUrl,
  revokeObjectUrl,
}: DocumentPreviewDialogProps) => {
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    if (open && doc) {
      setLoading(true);
      setUrl(null);
      setBlob(null);
      void getViewableUrl(doc).then((res) => {
        if (!active) {
          if (res?.url) revokeObjectUrl(res.url);
          return;
        }
        if (res) {
          currentUrl = res.url;
          setUrl(res.url);
          setMime(res.mime);
          setBlob(res.blob);
        }
        setLoading(false);
      });
    }
    return () => {
      active = false;
      if (currentUrl) revokeObjectUrl(currentUrl);
    };
  }, [open, doc, getViewableUrl, revokeObjectUrl]);

  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");

  const handleDownload = () => {
    if (!url || !doc) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.file_name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-4 gap-3">
        <DialogHeader className="space-y-1">
          <DialogTitle className="truncate text-base">
            {doc?.file_name ?? "Document"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 rounded-md border bg-muted/30 overflow-hidden">
          {loading || !url ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              <AppLoader variant="inline" className="mr-2" />
              Loading preview…
            </div>
          ) : isPdf && blob ? (
            <PdfCanvasPreview blob={blob} fileName={doc?.file_name ?? "PDF document"} />
          ) : isImage ? (
            <div className="h-full flex items-center justify-center p-2 overflow-auto">
              <img
                src={url}
                alt={doc?.file_name}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground p-6 text-center">
              <p>Preview isn't supported for this file type.</p>
              <p className="text-xs">Use Download to open it locally.</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button type="button" onClick={handleDownload} disabled={!url}>
            <Download className="w-4 h-4 mr-1" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const PdfCanvasPreview = ({ blob, fileName }: { blob: Blob; fileName: string }) => {
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pages = pagesRef.current;
    if (!pages) return;

    pages.replaceChildren();
    setRendering(true);
    setError(null);

    const render = async () => {
      try {
        const data = await blob.arrayBuffer();
        const pdf = await getDocument({ data }).promise;
        const width = Math.max(pages.clientWidth - 32, 320);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;

          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(width / baseViewport.width, 2);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas rendering is not available");

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className = "max-w-full rounded-sm border border-border bg-background shadow-sm";
          canvas.setAttribute("aria-label", `${fileName} page ${pageNumber}`);

          const pageWrap = document.createElement("div");
          pageWrap.className = "flex justify-center py-3";
          pageWrap.appendChild(canvas);
          pages.appendChild(pageWrap);

          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }

        if (!cancelled) setRendering(false);
      } catch (e) {
        console.error("PDF render failed", e);
        if (!cancelled) {
          setError("Could not render this PDF preview. Use Download to open it locally.");
          setRendering(false);
        }
      }
    };

    void render();

    return () => {
      cancelled = true;
      pages.replaceChildren();
    };
  }, [blob, fileName]);

  return (
    <div className="relative h-full overflow-auto bg-muted/20">
      <div ref={pagesRef} className="min-h-full" />
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
          <AppLoader variant="inline" className="mr-2" />
          Rendering PDF…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {error}
        </div>
      )}
    </div>
  );
};
