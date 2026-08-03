import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Eye, ExternalLink, FileText, Link2, Trash2, Upload } from "lucide-react";
import {
  useDealDocuments,
  isLinkDoc,
  type DealDocumentKind,
  type DealDocument,
} from "@/hooks/useDealDocuments";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";
import { AppLoader } from "@/components/ui/loader";

interface DealDocumentsSectionProps {
  dealId?: string;
  requireSignedContract?: boolean;
  showSignedContractSlot?: boolean;
  showPoSlot?: boolean;
  showRfqSubmittedSlot?: boolean;
  requireRfqSubmitted?: boolean;
  showProposalSlot?: boolean;
}

const KIND_LABELS: Record<DealDocumentKind, string> = {
  signed_contract: "Signed Contract",
  po: "PO Document",
  rfq_submitted: "Submitted RFQ / Proposal",
  proposal: "Proposal Document",
  other: "Supporting Documents",
};

const ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg";

export const DealDocumentsSection = ({
  dealId,
  requireSignedContract = false,
  showSignedContractSlot = false,
  showPoSlot = false,
  showRfqSubmittedSlot = false,
  requireRfqSubmitted = false,
  showProposalSlot = false,
}: DealDocumentsSectionProps) => {
  const {
    docs,
    loading,
    busy,
    upload,
    addLink,
    remove,
    getViewableUrl,
    revokeObjectUrl,
    hasKind,
  } = useDealDocuments(dealId);

  const [previewDoc, setPreviewDoc] = useState<DealDocument | null>(null);
  const [linkKind, setLinkKind] = useState<DealDocumentKind | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");

  const openLinkDialog = (kind: DealDocumentKind) => {
    setLinkKind(kind);
    setLinkUrl("");
    setLinkLabel("");
  };

  const submitLink = async () => {
    if (!linkKind || !linkUrl.trim()) return;
    const saved = await addLink(linkKind, linkUrl, linkLabel);
    if (saved) setLinkKind(null);
  };

  const inputs = useRef<Record<DealDocumentKind, HTMLInputElement | null>>({
    signed_contract: null,
    po: null,
    rfq_submitted: null,
    proposal: null,
    other: null,
  });

  const trigger = (kind: DealDocumentKind) => inputs.current[kind]?.click();

  const onPick = async (kind: DealDocumentKind, file: File | undefined) => {
    if (!file) return;
    await upload(kind, file);
  };

  const slots: Array<{ kind: DealDocumentKind; required?: boolean; show: boolean }> = [
    { kind: "signed_contract", required: requireSignedContract, show: showSignedContractSlot || requireSignedContract },
    { kind: "rfq_submitted", required: requireRfqSubmitted, show: showRfqSubmittedSlot || requireRfqSubmitted },
    { kind: "proposal", show: showProposalSlot },
    { kind: "po", show: showPoSlot },
    { kind: "other", show: true },
  ];

  if (!dealId) {
    return (
      <div className="flex items-start gap-2 p-2 rounded-md bg-muted/40 border border-border text-xs">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-muted-foreground" />
        <span>Save the deal first to attach documents.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Documents</h3>
        {loading && <AppLoader variant="inline" />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {slots
          .filter((s) => s.show)
          .map((s) => {
            const hits = docs.filter((d) => d.kind === s.kind);
            return (
              <div
                key={s.kind}
                className="rounded-md border border-border p-2 space-y-1.5 bg-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium truncate">
                      {KIND_LABELS[s.kind]}
                    </span>
                    {s.required && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
                        Required
                      </Badge>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => trigger(s.kind)}
                    className="h-6 px-2 text-[11px]"
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    Upload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => openLinkDialog(s.kind)}
                    className="h-6 px-2 text-[11px]"
                  >
                    <Link2 className="w-3 h-3 mr-1" />
                    Add link
                  </Button>
                  <input
                    ref={(el) => (inputs.current[s.kind] = el)}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      void onPick(s.kind, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>

                {hits.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No file or link attached.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {hits.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-1 text-[11px] leading-tight"
                      >
                        <span
                          className="truncate flex items-center gap-1"
                          title={isLinkDoc(d) ? d.external_url ?? d.file_name : d.file_name}
                        >
                          {isLinkDoc(d) && <Link2 className="w-3 h-3 shrink-0 text-muted-foreground" />}
                          <span className="truncate">{d.file_name}</span>
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {isLinkDoc(d) ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() =>
                                window.open(d.external_url ?? "", "_blank", "noopener,noreferrer")
                              }
                              aria-label={`Open ${d.file_name}`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => setPreviewDoc(d)}
                              aria-label={`View ${d.file_name}`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={busy}
                            onClick={() => void remove(d)}
                            aria-label={`Delete ${d.file_name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
      </div>

      <Dialog open={!!linkKind} onOpenChange={(o) => !o && setLinkKind(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add document link{linkKind ? ` — ${KIND_LABELS[linkKind]}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="doc-link-url">Document URL</Label>
              <Input
                id="doc-link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://sharepoint.com/..."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-link-label">Label (optional)</Label>
              <Input
                id="doc-link-label"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="RFQ submission - v1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkKind(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !linkUrl.trim()} onClick={() => void submitLink()}>
              Save link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentPreviewDialog
        doc={previewDoc}
        open={!!previewDoc}
        onOpenChange={(o) => !o && setPreviewDoc(null)}
        getViewableUrl={getViewableUrl}
        revokeObjectUrl={revokeObjectUrl}
      />
    </div>
  );
};
