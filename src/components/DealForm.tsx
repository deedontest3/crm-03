
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { Deal, DealStage, getNextStage, DEAL_STAGES, STAGE_PROBABILITY, isForwardPipelineMove, isBackwardPipelineMove, isTransitionAllowed, buildClearPayloadForBackwardMove, TERMINAL_STAGES, getStageLabel } from "@/types/deal";
import { useUserRole } from "@/hooks/useUserRole";
import { BackwardStageConfirmDialog } from "./deal-form/BackwardStageConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { showToastOnce } from "@/lib/toastOnce";
import { getFieldErrors, validateDateLogic, validateWonStage } from "./deal-form/validation";
import { useDealRevenueSchedule } from "@/hooks/useDealRevenueSchedule";
import { useDealOfferedSchedule } from "@/hooks/useDealOfferedSchedule";
import { useDealDocuments } from "@/hooks/useDealDocuments";
import { formatMoney, getOfferedRevenueWindow, getOrphanedCells, type Currency } from "@/lib/revenueSchedule";
import { DealStageForm } from "./deal-form/DealStageForm";
import { DealActivityLogDialog } from "./deal-form/DealActivityLogDialog";
import { DealActionItemsModal } from "./DealActionItemsModal";
import { FinalTcvSyncDialog, type FinalTcvSyncMode } from "./deal-form/FinalTcvSyncDialog";
import { supabase } from "@/integrations/supabase/client";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return fallback;
};


interface DealFormProps {
  deal: Deal | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (dealData: Partial<Deal>) => Promise<void>;
  onRefresh?: () => Promise<void>;
  isCreating?: boolean;
  initialStage?: DealStage;
   onDelete?: (dealId: string) => void;
   /** DB field names to visually highlight (e.g. opened from the forecast-exclusion dialog). */
   highlightFields?: string[];
}

 export const DealForm = ({ deal, isOpen, onClose, onSave, isCreating = false, initialStage, onRefresh, onDelete, highlightFields }: DealFormProps) => {
   const [deleteLoading, setDeleteLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<Deal>>({});
  const [loading, setLoading] = useState(false);
  const [showPreviousStages, setShowPreviousStages] = useState(false);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ data: Partial<Deal>; warnings: string[] } | null>(null);
  const [mismatchPrompt, setMismatchPrompt] = useState<
    | {
        mode: 'offered-vs-tcv' | 'won-vs-offered';
        scheduleSum: number;
        tcv?: number;
        offeredSum?: number;
        wonSum?: number;
        pendingAction: (overrides?: Partial<Deal>) => Promise<void>;
      }
    | null
  >(null);
  const [backwardPrompt, setBackwardPrompt] = useState<{ targetStage: DealStage } | null>(null);
  const { toast } = useToast();
  const { isAdminOrAbove } = useUserRole();
  const { rows: scheduleRows } = useDealRevenueSchedule(deal?.id);
  const {
    rows: offeredRows,
    upsertCell: offeredUpsertCell,
    deleteMany: offeredDeleteMany,
  } = useDealOfferedSchedule(deal?.id);
  const { hasKind: dealDocHasKind } = useDealDocuments(deal?.id);


  // Auto-fill Lead Owner for new deal creation to creator's profile full_name.
  // Uses profiles.full_name directly so the value matches the LeadOwnerDropdown options.
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  useEffect(() => {
    if (!isCreating) return;
    let cancelled = false;
    (async () => {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes?.user?.id) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userRes.user.id)
        .maybeSingle();
      const name = (profile as any)?.full_name?.trim();
      if (!cancelled && name) setCurrentUserFullName(name);
    })();
    return () => { cancelled = true; };
  }, [isCreating]);

  useEffect(() => {
    if (!isCreating || !currentUserFullName) return;
    setFormData(prev => {
      if (prev.lead_owner && prev.lead_owner !== "Unknown User") return prev;
      return { ...prev, lead_owner: currentUserFullName };
    });
  }, [isCreating, currentUserFullName, isOpen]);

  useEffect(() => {
    if (deal) {
      console.log("Setting form data from deal:", deal);
      // Initialize revenue fields with 0 if they are null
      const initializedDeal = {
        ...deal,
        quarterly_revenue_q1: deal.quarterly_revenue_q1 ?? 0,
        quarterly_revenue_q2: deal.quarterly_revenue_q2 ?? 0,
        quarterly_revenue_q3: deal.quarterly_revenue_q3 ?? 0,
        quarterly_revenue_q4: deal.quarterly_revenue_q4 ?? 0,
      };
      setFormData(initializedDeal);
      setShowValidationErrors(false);
    } else if (isCreating && initialStage) {
      // Set default values for new deals
      const defaultData: Partial<Deal> = {
        stage: initialStage,
        currency_type: 'EUR', // Default to EUR
        quarterly_revenue_q1: 0,
        quarterly_revenue_q2: 0,
        quarterly_revenue_q3: 0,
        quarterly_revenue_q4: 0,
      };
      setFormData(defaultData);
      setShowValidationErrors(false);
    }
    setShowPreviousStages(false);
  }, [deal, isCreating, initialStage, isOpen]);

  const currentStage = formData.stage || 'Lead';

  // Track which fields the user has interacted with so required-empty errors
  // appear only after the user touches them (no spam on a fresh form),
  // while date logic errors surface instantly regardless of touched state.
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Reset touched + validation state whenever the open deal changes
  useEffect(() => {
    setTouchedFields(new Set());
    setShowValidationErrors(false);
  }, [deal?.id, isOpen, isCreating]);

  // Live compute combined errors: stage-required + date logic.
  // Required-empty errors are gated by touched/showValidationErrors so the
  // form doesn't light up red on first open; date errors show immediately.
  useEffect(() => {
    const stageErrors = getFieldErrors(formData, currentStage as DealStage, {
      hasRfqSubmittedDocument: dealDocHasKind('rfq_submitted'),
    });
    const dateErrors = validateDateLogic(formData).fieldErrors || {};
    const combined: Record<string, string> = { ...dateErrors };
    for (const [field, msg] of Object.entries(stageErrors)) {
      if (showValidationErrors || touchedFields.has(field)) combined[field] = msg;
    }
    // Highlight the specific fields requested when opening from the forecast-exclusion dialog.
    if (isOpen && highlightFields && highlightFields.length > 0) {
      const amountGroup = ['final_tcv', 'total_revenue', 'total_contract_value'];
      const hasAmount = amountGroup.some((f) => Number((formData as any)[f]) > 0);
      highlightFields.forEach((f) => {
        if (combined[f]) return;
        if (amountGroup.includes(f)) {
          if (!hasAmount) combined[f] = 'Add an amount to include this deal in the forecast';
        } else if (f === 'probability') {
          if (!(Number((formData as any).probability) > 0)) combined[f] = 'Set a probability above 0%';
        } else if (!(formData as any)[f]) {
          combined[f] = 'Fill this to include the deal in the forecast';
        }
      });
    }
    setFieldErrors(combined);
  }, [formData, currentStage, showValidationErrors, touchedFields, dealDocHasKind, isOpen, highlightFields]);

  // Scroll first invalid field into view after a failed save attempt
  const scrollToFirstError = () => {
    requestAnimationFrame(() => {
      const el = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const focusable = el.querySelector<HTMLElement>('input, textarea, button, [tabindex]');
        focusable?.focus();
      }
    });
  };

  // When opened with highlighted fields, reveal earlier stages (so hidden fields render)
  // and scroll the first highlighted field into view.
  useEffect(() => {
    if (isOpen && highlightFields && highlightFields.length > 0) {
      setShowPreviousStages(true);
      const t = setTimeout(scrollToFirstError, 250);
      return () => clearTimeout(t);
    }
  }, [isOpen, highlightFields]);




  const finalTcvTouchedRef = useRef(false);
  const [pendingFinalTcvSync, setPendingFinalTcvSync] = useState<
    | {
        oldTcv: number;
        newTcv: number;
        scheduleSum: number;
        onResolve?: (
          action: 'apply' | 'cancel',
          mode?: FinalTcvSyncMode,
          revisedCells?: Array<{ year: number; quarter: 1 | 2 | 3 | 4; revenue: number }>
        ) => void;
      }
    | null
  >(null);

  const handleFieldChange = (field: string, value: any) => {
    console.log(`=== FIELD UPDATE DEBUG ===`);
    console.log(`Updating field: ${field}`);
    console.log(`New value:`, value, `(type: ${typeof value})`);

    if (field === 'final_tcv') finalTcvTouchedRef.current = true;

    setTouchedFields(prev => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });

    setFormData(prev => {
      const updated: any = { ...prev };
      updated[field] = value;
      // Auto-sync probability whenever stage changes
      if (field === 'stage' && value && STAGE_PROBABILITY[value as DealStage] !== undefined) {
        updated.probability = STAGE_PROBABILITY[value as DealStage];
      }
      // Mirror Project Start Date between RFQ (start_date) and Verbal Approval (implementation_start_date)
      if (field === 'start_date') {
        updated.implementation_start_date = value;
      } else if (field === 'implementation_start_date') {
        updated.start_date = value;
      }
      return updated;
    });
  };


  // Reset touched flag when a different deal loads, so opening the form
  // never auto-prompts based on stored values.
  useEffect(() => {
    finalTcvTouchedRef.current = false;
    setPendingFinalTcvSync(null);
  }, [deal?.id, isOpen]);

  // Debounced detection: when user edits Final TCV and it diverges from
  // Total Contract Value, open the sync dialog.
  useEffect(() => {
    if (!finalTcvTouchedRef.current) return;
    const ft = Number(formData.final_tcv);
    if (!isFinite(ft) || ft <= 0) return;
    const tcv = Number(formData.total_contract_value) || 0;
    if (Math.abs(ft - tcv) < 0.01) return;
    const t = setTimeout(() => {
      const scheduleSum = (offeredRows || []).reduce(
        (a: number, r: any) => a + (Number(r.revenue) || 0),
        0
      );
      setPendingFinalTcvSync({ oldTcv: tcv, newTcv: ft, scheduleSum });
      finalTcvTouchedRef.current = false;
    }, 800);
    return () => clearTimeout(t);
  }, [formData.final_tcv, formData.total_contract_value, offeredRows]);

  const applyFinalTcvSync = async (
    mode: FinalTcvSyncMode,
    revisedCells?: Array<{ year: number; quarter: 1 | 2 | 3 | 4; revenue: number }>
  ) => {
    if (!pendingFinalTcvSync) return;
    const { newTcv, scheduleSum } = pendingFinalTcvSync;
    // 1. Always update TCV in form state
    setFormData(prev => ({ ...prev, total_contract_value: newTcv }));

    // 2. Optionally write user-revised Offered schedule cells
    if (mode === 'tcv-and-rescale' && scheduleSum > 0 && deal?.id && revisedCells && revisedCells.length > 0) {
      try {
        for (const c of revisedCells) {
          await offeredUpsertCell({
            year: c.year,
            quarter: c.quarter,
            revenue: Math.round(Number(c.revenue) * 100) / 100,
          });
        }
        toast({
          title: 'Forecast updated',
          description: `Offered Revenue Schedule updated to match ${formatMoney(newTcv, (formData.currency_type as Currency) || 'EUR')}.`,
        });
      } catch (e: any) {
        toast({
          title: 'Update failed',
          description: e?.message || 'Could not update forecast cells.',
          variant: 'destructive',
        });
      }
    }
    setPendingFinalTcvSync(null);
  };


  const handleContactSelect = (contact: any) => {
    console.log("Selected contact:", contact);
    // The contact selection is handled in the FormFieldRenderer component
  };

  const persistSave = async (saveData: Partial<Deal>) => {
    await onSave(prepareDealSavePayload(saveData));
    await maybeCreateNextStepActionItem(saveData);
    showToastOnce({
      title: "Success",
      description: isCreating ? "Deal created successfully" : "Deal updated successfully",
    });
    if (onRefresh) await onRefresh();
    onClose();
  };

  // When saving a Discussions-stage deal with a Next Step + due date,
  // auto-create an Action Item (de-duped against existing rows for the deal).
  const maybeCreateNextStepActionItem = async (saveData: Partial<Deal>) => {
    try {
      const dealId = (saveData as any).id || deal?.id;
      if (!dealId) return; // create-mode: no id yet
      if (saveData.stage !== 'Discussions') return;
      const title = (saveData.next_step || '').trim();
      const dueDate = (saveData.next_step_due_date || '').trim();
      if (!title || !dueDate) return;

      // Skip if next_step/due_date are unchanged from the loaded deal.
      const prevTitle = (deal?.next_step || '').trim();
      const prevDue = (deal?.next_step_due_date || '').trim();
      if (title === prevTitle && dueDate === prevDue) return;

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id;
      if (!userId) return;

      // De-dupe: skip if an action item with same title+due_date already exists for this deal.
      const { data: existing } = await supabase
        .from('action_items' as any)
        .select('id')
        .eq('module_type', 'deals')
        .eq('module_id', dealId)
        .eq('title', title)
        .eq('due_date', dueDate)
        .limit(1);
      if (existing && existing.length > 0) return;

      await supabase.from('action_items' as any).insert({
        module_type: 'deals',
        module_id: dealId,
        title,
        due_date: dueDate,
        priority: 'Medium',
        status: 'Open',
        created_by: userId,
      } as any);
    } catch (err) {
      console.warn('Auto action item creation skipped:', err);
    }
  };

  const notifyStageMoved = (stage: DealStage) => {
    showToastOnce({
      title: "Success",
      description: `Deal moved to ${getStageLabel(stage)} stage`,
    });
  };

  const EPS = 0.01;
  const currency: Currency = ((formData.currency_type as Currency) || 'EUR');
  const fmt = (n: number) => formatMoney(n, currency);

  const prepareDealSavePayload = (data: Partial<Deal>): Partial<Deal> => {
    const next: any = { ...data };

    // Strip UI-only flags that are not real DB columns.
    delete next.__currency_manually_set;
    delete next.__duration_manually_set;

    // Compatibility guard for older DB trigger versions that may still reject
    // rows with Project Start Date unless Handoff Status has a value. The user
    // no longer needs to fill Handoff Status just to save earlier stages.
    if (next.implementation_start_date && !next.handoff_status) {
      next.handoff_status = 'Not Started';
    }

    return next;
  };

  const sumRows = (rs: Array<{ revenue: number | string | null | undefined }>) =>
    rs.reduce((a, r) => a + (Number(r.revenue) || 0), 0);

  /** Detect a schedule/TCV mismatch for the current stage. Returns null when OK. */
  const detectMismatch = (
    data: Partial<Deal>
  ):
    | { mode: 'offered-vs-tcv'; scheduleSum: number; tcv: number }
    | { mode: 'won-vs-offered'; wonSum: number; offeredSum: number; scheduleSum: number }
    | null => {
    if (isCreating || !deal?.id) return null;
    // Use the user's CURRENT stage — the rule fires before they leave it / save it.
    const stage = currentStage as DealStage;
    if (stage === 'Offered') {
      const sum = sumRows(offeredRows as any);
      const tcv = Number(data.total_contract_value) || 0;
      if (tcv > 0 && Math.abs(sum - tcv) > EPS) {
        return { mode: 'offered-vs-tcv', scheduleSum: sum, tcv };
      }
    }
    if (stage === 'Won') {
      const wonSum = sumRows(scheduleRows as any);
      const offeredSum = sumRows(offeredRows as any);
      if (offeredSum > 0 && Math.abs(wonSum - offeredSum) > EPS) {
        return { mode: 'won-vs-offered', wonSum, offeredSum, scheduleSum: wonSum };
      }
    }
    return null;
  };

  const blockStageMoveIfInvalid = (data: Partial<Deal>, targetStage: DealStage): boolean => {
    // Exit-based validation: when advancing along the pipeline, require the
    // CURRENT stage's required fields (the ones owned by the stage we're
    // leaving). For backward moves or terminal targets, validate the target.
    const fromStage = (deal?.stage ?? currentStage) as DealStage | undefined;
    const forward = fromStage ? isForwardPipelineMove(fromStage, targetStage) : false;
    const backward = fromStage ? isBackwardPipelineMove(fromStage, targetStage) : false;
    const validationStage: DealStage = TERMINAL_STAGES.includes(targetStage)
      ? targetStage
      : forward
        ? (fromStage as DealStage)
        : targetStage;
    const dataForCheck = forward && !TERMINAL_STAGES.includes(targetStage)
      ? { ...data, stage: fromStage }
      : data;
    const stageErrors = backward
      ? {}
      : getFieldErrors(dataForCheck, validationStage, { hasRfqSubmittedDocument: dealDocHasKind('rfq_submitted') });
    const stageErrorList = Object.values(stageErrors);
    if (stageErrorList.length > 0) {
      // Terminal-stage entry (Won/Lost/Dropped): switch the form view to the
      // target stage so the user can fill required fields, instead of blocking
      // with a destructive toast. The destructive toast still fires on Save.
      if (TERMINAL_STAGES.includes(targetStage)) {
        setFormData(data);
        setShowValidationErrors(true); scrollToFirstError();
        setFieldErrors(stageErrors);
        toast({
          title: `Fill required fields for ${getStageLabel(targetStage)}`,
          description: `Then click Save to confirm the move to ${getStageLabel(targetStage)}.`,
        });
        // Block the persist call; user must complete fields and press Save.
        return true;
      }
      // Exit-based: keep the user on the CURRENT stage and highlight what's
      // missing there. Never pre-flash next-stage errors.
      setFormData(data);
      setShowValidationErrors(true); scrollToFirstError();
      setFieldErrors(stageErrors);
      toast({
        title: forward
          ? `Complete required fields for ${getStageLabel(validationStage)} before moving to ${getStageLabel(targetStage)}`
          : "Missing required fields",
        description: stageErrorList.slice(0, 4).join(' • ') +
          (stageErrorList.length > 4 ? ` • +${stageErrorList.length - 4} more` : ''),
        variant: "destructive",
      });
      return true;
    }

    // Rollbacks are intentionally confirmation-driven instead of validation-driven:
    // the user has already chosen whether to keep or clear later-stage data, so
    // stale dates/required fields from the old later stage must not block moving back.
    if (backward) return false;

    const dateCheck = validateDateLogic(data);
    if (!dateCheck.isValid) {
      setFormData(data);
      if (dateCheck.fieldErrors) {
        setShowValidationErrors(true); scrollToFirstError();
        setFieldErrors(dateCheck.fieldErrors);
      }
      toast({
        title: "Date error",
        description: dateCheck.error,
        variant: "destructive",
      });
      return true;
    }

    return false;
  };


  /** Overwrite the Offered schedule to mirror the Won schedule. */
  const overwriteOfferedFromWon = async () => {
    const wonCells = (scheduleRows as any[]).map((r) => ({
      year: r.year as number,
      quarter: r.quarter as 1 | 2 | 3 | 4,
      revenue: Number(r.revenue) || 0,
    }));
    const wonKeys = new Set(wonCells.map((c) => `${c.year}-${c.quarter}`));
    const extras = (offeredRows as any[])
      .filter((r) => !wonKeys.has(`${r.year}-${r.quarter}`))
      .map((r) => ({ year: r.year as number, quarter: r.quarter as 1 | 2 | 3 | 4 }));
    if (extras.length > 0) await offeredDeleteMany(extras);
    for (const c of wonCells) {
      await offeredUpsertCell({ year: c.year, quarter: c.quarter, revenue: c.revenue });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      const saveData = {
        ...formData,
        deal_name: formData.project_name || formData.deal_name || 'Untitled Deal',
        modified_at: new Date().toISOString(),
        modified_by: deal?.created_by || formData.created_by
      };

      // Final TCV vs TCV divergence gate — prompt the user to sync TCV
      // (and optionally revise the Offered forecast) before saving.
      const ftSave = Number(saveData.final_tcv);
      const tcvSave = Number(saveData.total_contract_value) || 0;
      if (isFinite(ftSave) && ftSave > 0 && Math.abs(ftSave - tcvSave) >= EPS) {
        const scheduleSum = (offeredRows || []).reduce(
          (a: number, r: any) => a + (Number(r.revenue) || 0),
          0
        );
        const resolution = await new Promise<{
          action: 'apply' | 'cancel';
          mode?: FinalTcvSyncMode;
          revisedCells?: Array<{ year: number; quarter: 1 | 2 | 3 | 4; revenue: number }>;
        }>((resolve) => {
          setPendingFinalTcvSync({
            oldTcv: tcvSave,
            newTcv: ftSave,
            scheduleSum,
            onResolve: (action, mode, revisedCells) => resolve({ action, mode, revisedCells }),
          });
        });
        if (resolution.action === 'apply' && resolution.mode) {
          saveData.total_contract_value = ftSave;
          if (
            resolution.mode === 'tcv-and-rescale' &&
            scheduleSum > 0 &&
            deal?.id &&
            resolution.revisedCells &&
            resolution.revisedCells.length > 0
          ) {
            try {
              for (const c of resolution.revisedCells) {
                await offeredUpsertCell({
                  year: c.year,
                  quarter: c.quarter,
                  revenue: Math.round(Number(c.revenue) * 100) / 100,
                });
              }
            } catch (e: any) {
              toast({
                title: 'Update failed',
                description: e?.message || 'Could not update forecast cells.',
                variant: 'destructive',
              });
              setLoading(false);
              return;
            }
          }
          setFormData(prev => ({ ...prev, total_contract_value: ftSave }));
        }
      }

      // Offered stage hard gate: require at least one non-zero forecast cell when TCV > 0.
      // (Orphan cells outside the RFQ window are auto-cleared by OfferedStageForm.)
      if (!isCreating && deal?.id && (currentStage as DealStage) === 'Offered') {

        const tcvNum = Number(saveData.total_contract_value) || 0;
        const offeredSum = sumRows(offeredRows as any);
        if (tcvNum > 0 && offeredSum === 0) {
          toast({
            title: "Forecast required",
            description: "Enter at least one non-zero quarterly forecast before saving Offered.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      // Schedule/TCV mismatch gate — runs first so a wrong-total schedule
      // surfaces the dedicated dialog instead of getting masked by a
      // generic "missing required fields" toast.
      const mm = detectMismatch(saveData);
      if (mm) {
        setMismatchPrompt({
          ...mm,
          pendingAction: async (overrides) => {
            const finalData = overrides ? { ...saveData, ...overrides } : saveData;
            // Re-run the remaining gates after the user resolves the mismatch
            const stageErrors2 = getFieldErrors(finalData, currentStage as DealStage, { hasRfqSubmittedDocument: dealDocHasKind('rfq_submitted') });
            const stageErrorList2 = Object.values(stageErrors2);
            if (stageErrorList2.length > 0) {
              setShowValidationErrors(true); scrollToFirstError();
              setFieldErrors(stageErrors2);
              toast({
                title: "Missing required fields",
                description: stageErrorList2.slice(0, 4).join(' • ') +
                  (stageErrorList2.length > 4 ? ` • +${stageErrorList2.length - 4} more` : ''),
                variant: "destructive",
              });
              return;
            }
            const dateCheck2 = validateDateLogic(finalData);
            if (!dateCheck2.isValid) {
              if (dateCheck2.fieldErrors) {
                setShowValidationErrors(true); scrollToFirstError();
                setFieldErrors(dateCheck2.fieldErrors);
              }
              toast({ title: "Date error", description: dateCheck2.error, variant: "destructive" });
              return;
            }
            await persistSave(finalData);
          },
        });
        setLoading(false);
        return;
      }

      // Stage-required-field validation (applies to ALL stages)
      const stageErrors = getFieldErrors(saveData, currentStage as DealStage, { hasRfqSubmittedDocument: dealDocHasKind('rfq_submitted') });
      const stageErrorList = Object.values(stageErrors);
      if (stageErrorList.length > 0) {
        setShowValidationErrors(true); scrollToFirstError();
        setFieldErrors(stageErrors);
        toast({
          title: "Missing required fields",
          description: stageErrorList.slice(0, 4).join(' • ') +
            (stageErrorList.length > 4 ? ` • +${stageErrorList.length - 4} more` : ''),
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Date-order sanity
      const dateCheck = validateDateLogic(saveData);
      if (!dateCheck.isValid) {
        if (dateCheck.fieldErrors) {
          setShowValidationErrors(true); scrollToFirstError();
          setFieldErrors(dateCheck.fieldErrors);
        }
        toast({ title: "Date error", description: dateCheck.error, variant: "destructive" });
        setLoading(false);
        return;
      }

      // Won-stage validation
      if (currentStage === 'Won') {
        const { errors, warnings } = validateWonStage(
          saveData,
          scheduleRows.map(r => ({ year: r.year, quarter: r.quarter, revenue: Number(r.revenue) || 0 })),
          { hasSignedContractDocument: dealDocHasKind('signed_contract') }
        );
        if (errors.length > 0) {
          toast({
            title: "Cannot save — fix the following:",
            description: errors.join(' • '),
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        if (warnings.length > 0) {
          setPendingSave({ data: saveData, warnings });
          setLoading(false);
          return;
        }
      }


      await persistSave(saveData);
    } catch (error: any) {
      console.error("=== DEAL FORM SAVE ERROR ===", error);
      toast({
        title: "Error",
        description: `Failed to save deal: ${error?.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const confirmPendingSave = async () => {
    if (!pendingSave) return;
    setLoading(true);
    try {
      await persistSave(pendingSave.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Failed to save deal: ${error?.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setPendingSave(null);
      setLoading(false);
    }
  };

  const handleMoveToNextStage = async () => {
    if (loading) return;
    setLoading(true);
    
    try {
      const nextStage = getNextStage(currentStage);
      if (nextStage) {
        console.log(`Moving deal from ${currentStage} to ${nextStage}`);
        
        const updatedData = {
          ...formData,
          stage: nextStage,
          probability: STAGE_PROBABILITY[nextStage],
          deal_name: formData.project_name || formData.deal_name || 'Untitled Deal',
          modified_at: new Date().toISOString(),
          modified_by: deal?.created_by || formData.created_by
        };

        if (blockStageMoveIfInvalid(updatedData, nextStage)) {
          setLoading(false);
          return;
        }

        const mm = detectMismatch(updatedData);
        if (mm) {
          setMismatchPrompt({
            ...mm,
            pendingAction: async (overrides) => {
              const final = overrides ? { ...updatedData, ...overrides } : updatedData;
              await onSave(prepareDealSavePayload(final));
              notifyStageMoved(nextStage);
              onClose();
              if (onRefresh) setTimeout(() => onRefresh(), 200);
            },
          });
          setLoading(false);
          return;
        }

        await onSave(prepareDealSavePayload(updatedData));
        
        notifyStageMoved(nextStage);
        
        
        onClose();
        if (onRefresh) {
          setTimeout(() => onRefresh(), 200);
        }
      }
    } catch (error) {
      console.error("Error moving deal to next stage:", error);
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to move deal to next stage"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToFinalStage = async (finalStage: DealStage) => {
    if (loading) return;
    setLoading(true);
    
    try {
      console.log(`Moving deal to final stage: ${finalStage}`);
      
      const updatedData = {
        ...formData,
        stage: finalStage,
        probability: STAGE_PROBABILITY[finalStage],
        deal_name: formData.project_name || formData.deal_name || 'Untitled Deal',
        modified_at: new Date().toISOString(),
        modified_by: deal?.created_by || formData.created_by
      };

      if (blockStageMoveIfInvalid(updatedData, finalStage)) {
        setLoading(false);
        return;
      }

      const mm = detectMismatch(updatedData);
      if (mm) {
        setMismatchPrompt({
          ...mm,
          pendingAction: async (overrides) => {
            const final = overrides ? { ...updatedData, ...overrides } : updatedData;
            setFormData(final);
            await onSave(prepareDealSavePayload(final));
            notifyStageMoved(finalStage);
            onClose();
            if (onRefresh) setTimeout(() => onRefresh(), 200);
          },
        });
        setLoading(false);
        return;
      }

      setFormData(updatedData);
      await onSave(prepareDealSavePayload(updatedData));
      
      notifyStageMoved(finalStage);
      
      
      onClose();
      if (onRefresh) {
        setTimeout(() => onRefresh(), 200);
      }
    } catch (error) {
      console.error("Error moving deal to final stage:", error);
      toast({
        title: "Error",
        description: getErrorMessage(error, `Failed to move deal to ${finalStage} stage`),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const performStageMove = async (targetStage: DealStage, clearOverrides?: Partial<Deal>) => {
    if (loading) return;
    setLoading(true);

    try {
      console.log(`Moving deal from ${currentStage} to ${targetStage}`);
      const isBackward = isBackwardPipelineMove(currentStage, targetStage);

      const updatedData = {
        ...formData,
        ...(clearOverrides ?? {}),
        stage: targetStage,
        probability: STAGE_PROBABILITY[targetStage],
        deal_name: formData.project_name || formData.deal_name || 'Untitled Deal',
        modified_at: new Date().toISOString(),
        modified_by: deal?.created_by || formData.created_by
      };

      if (blockStageMoveIfInvalid(updatedData, targetStage)) {
        setLoading(false);
        return;
      }

      const mm = isBackward ? null : detectMismatch(updatedData);
      if (mm) {
        setMismatchPrompt({
          ...mm,
          pendingAction: async (overrides) => {
            const final = overrides ? { ...updatedData, ...overrides } : updatedData;
            setFormData(final);
            await onSave(prepareDealSavePayload(final));
            notifyStageMoved(targetStage);
            if (onRefresh) setTimeout(() => onRefresh(), 200);
          },
        });
        setLoading(false);
        return;
      }

      setFormData(updatedData);
      await onSave(prepareDealSavePayload(updatedData));

      notifyStageMoved(targetStage);

      if (onRefresh) {
        setTimeout(() => onRefresh(), 200);
      }
    } catch (error) {
      console.error("Error moving deal to stage:", error);
      const raw = getErrorMessage(error, `Failed to move deal to ${getStageLabel(targetStage)} stage`);
      // Map known Postgres trigger messages to friendly, field-scoped UX.
      if (/Next Step is required from Discussions onward/i.test(raw)) {
        setFormData((prev) => ({ ...prev, stage: targetStage, probability: STAGE_PROBABILITY[targetStage] }));
        setFieldErrors((prev) => ({ ...prev, next_step: 'Next Step is required from Discussions onward.' }));
        setShowValidationErrors(true); scrollToFirstError();
        toast({
          title: `Complete required fields for ${getStageLabel(targetStage)}`,
          description: 'Next Step is required from Discussions onward.',
          variant: 'destructive',
        });
      } else if (/Business Unit \(BU\) is required/i.test(raw)) {
        setFieldErrors((prev) => ({ ...prev, bu: 'Business Unit (BU) is required before moving past Lead.' }));
        setShowValidationErrors(true); scrollToFirstError();
        toast({
          title: 'Business Unit (BU) is required',
          description: 'Select at least one BU before moving past Lead.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: raw,
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToSpecificStage = async (targetStage: DealStage) => {
    if (loading) return;
    // Won is closed-won and locked (admin may only reopen to Verbal Approval).
    const gate = isTransitionAllowed(currentStage as DealStage, targetStage, { isAdmin: isAdminOrAbove });
    if (!gate.allowed) {
      toast({ title: "Move blocked", description: gate.reason, variant: "destructive" });
      return;
    }
    // Backward (non-terminal) moves require confirmation + data-handling choice.
    const isBackward =
      isBackwardPipelineMove(currentStage, targetStage);
    if (isBackward) {
      setBackwardPrompt({ targetStage });
      return;
    }
    await performStageMove(targetStage);
  };

  // Available stages depend on Won-lock rules for the current user.
  const getAvailableStagesForMoveTo = (): DealStage[] => {
    return DEAL_STAGES.filter(stage => {
      if (stage === currentStage) return false;
      return isTransitionAllowed(currentStage as DealStage, stage, { isAdmin: isAdminOrAbove }).allowed;
    });
  };

  // No validation - always allow movement and saving
  const canMoveToNextStage = !isCreating && getNextStage(currentStage) !== null;
  const canMoveToFinalStage = !isCreating;
  const canSave = true; // Always allow saving

  const handleActionButtonClick = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent form submission
    e.stopPropagation(); // Stop event bubbling
    setActionModalOpen(true);
  };

   const handleDelete = async () => {
     if (!deal?.id || !onDelete) return;
     
     setDeleteLoading(true);
     try {
       onDelete(deal.id);
       onClose();
     } catch (error) {
       console.error("Error deleting deal:", error);
       toast({
         title: "Error",
         description: "Failed to delete deal",
         variant: "destructive",
       });
     } finally {
       setDeleteLoading(false);
     }
   };
 
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col p-0 deals-pipeline-form">
        <div className="px-6 pt-6 pb-2 shrink-0">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-2xl font-bold">
                  {isCreating ? 'Create New Deal' : formData.project_name || 'Edit Deal'}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-sm px-3 py-1">
                    {getStageLabel(currentStage)}
                  </Badge>
                  {!isCreating && currentStage !== 'Lead' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-2 border-primary/60 hover:border-primary hover:bg-primary/5 text-primary font-medium shadow-sm text-sm px-3 py-1 h-auto"
                      onClick={() => setShowPreviousStages(!showPreviousStages)}
                    >
                      {showPreviousStages ? 'Hide Previous Stages' : 'Show All Stages'}
                    </Button>
                  )}
                </div>
              </div>
              {!isCreating && formData.id && (
                <div className="pr-8">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Open deal logs"
                    className="border-2 border-primary/60 hover:border-primary hover:bg-primary/5 text-primary font-medium shadow-sm text-sm px-3 py-1 h-auto"
                    onClick={() => setActivityLogOpen(true)}
                  >
                    Logs
                  </Button>
                </div>
              )}
            </div>

          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <DealStageForm
              formData={formData}
              onFieldChange={handleFieldChange}
              onContactSelect={handleContactSelect}
              fieldErrors={fieldErrors}
              stage={currentStage}
              showPreviousStages={showPreviousStages}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center gap-2 px-6 py-4 border-t shrink-0">
            <div className="flex gap-2 items-center">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="btn-primary">
                {loading ? "Saving..." : "Save"}
              </Button>
               {/* Delete button - only for existing deals */}
               {!isCreating && deal && onDelete && (
                 <AlertDialog>
                   <AlertDialogTrigger asChild>
                     <Button
                       type="button"
                       variant="destructive"
                       size="sm"
                       disabled={deleteLoading}
                     >
                       {deleteLoading ? "Deleting..." : "Delete"}
                     </Button>
                   </AlertDialogTrigger>
                   <AlertDialogContent>
                     <AlertDialogHeader>
                       <AlertDialogTitle>Delete Deal</AlertDialogTitle>
                       <AlertDialogDescription>
                         Are you sure you want to delete "{deal.project_name || deal.deal_name}"? This action cannot be undone.
                       </AlertDialogDescription>
                     </AlertDialogHeader>
                     <AlertDialogFooter>
                       <AlertDialogCancel>Cancel</AlertDialogCancel>
                       <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                         Delete
                       </AlertDialogAction>
                     </AlertDialogFooter>
                   </AlertDialogContent>
                 </AlertDialog>
               )}
            </div>

            <div className="flex gap-2 items-center">
              {/* Move to Next Stage + dropdown override */}
              {!isCreating && getAvailableStagesForMoveTo().length > 0 && (() => {
                const nextStage = getNextStage(currentStage);
                return (
                  <div className="flex items-center">
                    {nextStage && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-r-none border-r-0 h-9"
                        onClick={() => handleMoveToSpecificStage(nextStage)}
                      >
                        Move to {getStageLabel(nextStage)}
                      </Button>
                    )}
                    <Select
                      value=""
                      onValueChange={(value) => {
                        handleMoveToSpecificStage(value as DealStage);
                      }}
                    >
                      <SelectTrigger
                        className={nextStage ? "w-9 h-9 rounded-l-none px-0 justify-center" : "w-[180px] h-9"}
                        aria-label="Move to other stage"
                      >
                        {nextStage ? null : <SelectValue placeholder="Select stage..." />}
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableStagesForMoveTo().map(stage => (
                          <SelectItem key={stage} value={stage}>
                            {getStageLabel(stage)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}
              {!isCreating && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleActionButtonClick}
                >
                  Action
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>

      {/* Logs Dialog */}
      <DealActivityLogDialog
        dealId={formData.id}
        dealName={formData.project_name || formData.deal_name || null}
        open={activityLogOpen}
        onOpenChange={setActivityLogOpen}
      />

      {/* Action Items Modal */}
      <DealActionItemsModal
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        deal={deal}
      />

      {/* Backward stage move confirmation */}
      <BackwardStageConfirmDialog
        open={!!backwardPrompt}
        currentStage={currentStage}
        targetStage={backwardPrompt?.targetStage ?? null}
        deal={formData}
        onCancel={() => setBackwardPrompt(null)}
        onConfirm={(choice) => {
          if (!backwardPrompt) return;
          const target = backwardPrompt.targetStage;
          setBackwardPrompt(null);
          const clear = choice === 'clear'
            ? buildClearPayloadForBackwardMove(target, currentStage, formData)
            : undefined;
          performStageMove(target, clear);
        }}
      />

      {/* Won-stage warnings confirmation */}
      <AlertDialog open={!!pendingSave} onOpenChange={(open) => !open && setPendingSave(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Save with warnings?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Please review the following before saving:</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {pendingSave?.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingSave}>Save anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule / TCV mismatch gate */}
      <AlertDialog
        open={!!mismatchPrompt}
        onOpenChange={(open) => !open && setMismatchPrompt(null)}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mismatchPrompt?.mode === 'offered-vs-tcv'
                ? "Revenue schedule doesn't match TCV"
                : "Won revenue doesn't match Offered forecast"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="min-w-0 space-y-2 text-sm">
            {mismatchPrompt?.mode === 'offered-vs-tcv' && (
              <div className="min-w-0 rounded-md border border-border bg-muted/40 p-3 space-y-1">
                <div className="flex min-w-0 justify-between gap-4"><span className="min-w-0 text-muted-foreground">TCV</span><span className="shrink-0 text-right font-medium">{fmt(mismatchPrompt.tcv ?? 0)}</span></div>
                <div className="flex min-w-0 justify-between gap-4"><span className="min-w-0 text-muted-foreground">Forecast Σ</span><span className="shrink-0 text-right font-medium">{fmt(mismatchPrompt.scheduleSum)}</span></div>
                <div className="flex min-w-0 justify-between gap-4 border-t border-border pt-1 mt-1"><span className="min-w-0 text-muted-foreground">Difference</span><span className="shrink-0 text-right font-semibold">{fmt((mismatchPrompt.scheduleSum) - (mismatchPrompt.tcv ?? 0))}</span></div>
              </div>
            )}
            {mismatchPrompt?.mode === 'won-vs-offered' && (
              <>
                <div className="min-w-0 rounded-md border border-border bg-muted/40 p-3 space-y-1">
                  <div className="flex min-w-0 justify-between gap-4"><span className="min-w-0 text-muted-foreground">Offered forecast Σ</span><span className="shrink-0 text-right font-medium">{fmt(mismatchPrompt.offeredSum ?? 0)}</span></div>
                  <div className="flex min-w-0 justify-between gap-4"><span className="min-w-0 text-muted-foreground">Won schedule Σ</span><span className="shrink-0 text-right font-medium">{fmt(mismatchPrompt.wonSum ?? 0)}</span></div>
                  <div className="flex min-w-0 justify-between gap-4 border-t border-border pt-1 mt-1"><span className="min-w-0 text-muted-foreground">Difference</span><span className="shrink-0 text-right font-semibold">{fmt((mismatchPrompt.wonSum ?? 0) - (mismatchPrompt.offeredSum ?? 0))}</span></div>
                </div>
                <div className="min-w-0 rounded-md border border-border bg-muted/40 p-3 space-y-1">
                  <div className="flex min-w-0 justify-between gap-4"><span className="min-w-0 text-muted-foreground">Current TCV</span><span className="shrink-0 text-right font-medium">{fmt(Number(formData.total_contract_value) || 0)}</span></div>
                  <div className="flex min-w-0 justify-between gap-4"><span className="min-w-0 text-muted-foreground">Won schedule Σ (new TCV)</span><span className="shrink-0 text-right font-medium">{fmt(mismatchPrompt.wonSum ?? 0)}</span></div>
                </div>
              </>
            )}
          </div>
          <AlertDialogFooter className="flex-row flex-nowrap gap-2">
            <AlertDialogCancel className="h-9 whitespace-nowrap">Cancel</AlertDialogCancel>
            {mismatchPrompt?.mode === 'won-vs-offered' && (
              <Button
                variant="outline"
                className="h-9 whitespace-nowrap"
                onClick={async () => {
                  if (!mismatchPrompt) return;
                  setLoading(true);
                  try {
                    await overwriteOfferedFromWon();
                    await mismatchPrompt.pendingAction();
                  } catch (error: any) {
                    toast({ title: "Error", description: error?.message || 'Failed to apply update', variant: "destructive" });
                  } finally {
                    setMismatchPrompt(null);
                    setLoading(false);
                  }
                }}
              >
                Update Offered only
              </Button>
            )}
            <AlertDialogAction
              className="h-9 whitespace-nowrap"
              onClick={async () => {
                if (!mismatchPrompt) return;
                setLoading(true);
                try {
                  if (mismatchPrompt.mode === 'offered-vs-tcv') {
                    const newTcv = mismatchPrompt.scheduleSum;
                    handleFieldChange('total_contract_value', newTcv);
                    await mismatchPrompt.pendingAction({ total_contract_value: newTcv });
                  } else {
                    const newTcv = mismatchPrompt.wonSum ?? 0;
                    await overwriteOfferedFromWon();
                    handleFieldChange('total_contract_value', newTcv);
                    const overrides: any = { total_contract_value: newTcv };
                    if (Number(formData.final_tcv) > 0) overrides.final_tcv = newTcv;
                    await mismatchPrompt.pendingAction(overrides);
                  }
                } catch (error: any) {
                  toast({
                    title: "Error",
                    description: error?.message || 'Failed to apply update',
                    variant: "destructive",
                  });
                } finally {
                  setMismatchPrompt(null);
                  setLoading(false);
                }
              }}
            >
              {mismatchPrompt?.mode === 'offered-vs-tcv'
                ? `Update TCV to ${fmt(mismatchPrompt?.scheduleSum ?? 0)}`
                : `Update TCV & Offered`}
            </AlertDialogAction>
          </AlertDialogFooter>

        </AlertDialogContent>
      </AlertDialog>

      {pendingFinalTcvSync && (
        <FinalTcvSyncDialog
          open={!!pendingFinalTcvSync}
          oldTcv={pendingFinalTcvSync.oldTcv}
          newTcv={pendingFinalTcvSync.newTcv}
          scheduleSum={pendingFinalTcvSync.scheduleSum}
          currency={(formData.currency_type as Currency) || 'EUR'}
          cells={(offeredRows || [])
            .filter((r: any) => Number(r.revenue) > 0)
            .map((r: any) => ({
              year: r.year,
              quarter: r.quarter as 1 | 2 | 3 | 4,
              revenue: Number(r.revenue) || 0,
            }))}
          onCancel={() => {
            const resolve = pendingFinalTcvSync.onResolve;
            setPendingFinalTcvSync(null);
            resolve?.('cancel');
          }}
          onApply={(mode, revisedCells) => {
            const resolve = pendingFinalTcvSync.onResolve;
            if (resolve) {
              setPendingFinalTcvSync(null);
              resolve('apply', mode, revisedCells);
            } else {
              applyFinalTcvSync(mode, revisedCells);
            }
          }}
        />
      )}
    </Dialog>
  );
};
