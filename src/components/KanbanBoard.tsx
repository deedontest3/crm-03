import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Deal, DealStage, DEAL_STAGES, STAGE_PROBABILITY, TERMINAL_STAGES, isForwardPipelineMove, isBackwardPipelineMove, isAdjacentPipelineMove, isTransitionAllowed, getNextPipelineStage, buildBackwardMoveUpdates, type BackwardStageMoveRequest, BU_OPTIONS, type BUOption, getStageLabel } from "@/types/deal";
import { useUserRole } from "@/hooks/useUserRole";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Archive as ArchiveIcon, CheckSquare, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays } from "lucide-react";
import { BackwardStageConfirmDialog } from "./deal-form/BackwardStageConfirmDialog";
import { DealCard } from "./DealCard";
import { InlineDetailsPanel } from "./kanban/InlineDetailsPanel";
import { KanbanActionItemModal } from "./kanban/KanbanActionItemModal";
import type { ActionItem } from "@/hooks/useActionItems";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { showToastOnce } from "@/lib/toastOnce";
import { BulkActionsBar } from "./BulkActionsBar";
import { DealsAdvancedFilter, AdvancedFilterState } from "./DealsAdvancedFilter";
import { AnimatedStageHeaders } from "./kanban/AnimatedStageHeaders";
import { getFieldErrors } from "./deal-form/validation";
import { MissingFieldsDialog } from "./kanban/MissingFieldsDialog";
import { cn } from "@/lib/utils";
import { dateToFiscal, fiscalLabel, currentFiscalYear } from "@/lib/fiscalYear";

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return fallback;
};

const YEAR_STORAGE_KEY = "deals.selectedYear";
const FILTER_STORAGE_KEY = "deals-kanban-filters";

const isValidYearFilter = (value: unknown): value is string =>
  value === "all" || (typeof value === "string" && /^\d{4}$/.test(value));

const readStoredSelectedYear = (): string => {
  if (typeof window === "undefined") return "all";
  try {
    const directValue = window.localStorage.getItem(YEAR_STORAGE_KEY);
    if (isValidYearFilter(directValue)) return directValue;

    const savedFilters = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (savedFilters) {
      const parsed = JSON.parse(savedFilters);
      if (isValidYearFilter(parsed?.selectedYear)) return parsed.selectedYear;
    }
  } catch {
    // Ignore storage parse/access failures and fall back to all years.
  }
  return "all";
};

const writeStoredSelectedYear = (value: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(YEAR_STORAGE_KEY, value);

    const currentFilters = window.localStorage.getItem(FILTER_STORAGE_KEY);
    const parsed = currentFilters ? JSON.parse(currentFilters) : {};
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({ ...parsed, selectedYear: value })
    );
  } catch {
    // Ignore storage write failures.
  }
};

interface KanbanBoardProps {
  deals: Deal[];
  onUpdateDeal: (dealId: string, updates: Partial<Deal>) => Promise<void>;
  onDealClick: (deal: Deal) => void;
  onCreateDeal: (stage: DealStage) => void;
  onDeleteDeals: (dealIds: string[]) => void;
  onImportDeals: (deals: Partial<Deal>[]) => void;
  onRefresh: () => void;
  headerActions?: React.ReactNode;
  onOpenArchive?: () => void;
  canArchive?: boolean;
  onLoadAll?: () => void;
  hasMore?: boolean;
}

export const KanbanBoard = ({ 
  deals, 
  onUpdateDeal, 
  onDealClick, 
  onCreateDeal, 
  onDeleteDeals, 
  onImportDeals,
  onRefresh,
  headerActions,
  onOpenArchive,
  canArchive,
  onLoadAll,
  hasMore,
}: KanbanBoardProps) => {
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDeal, setExpandedDeal] = useState<{
    dealId: string;
    stageIndex: number;
  } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialUrlYear = searchParams.get("year");
  const [selectedYear, setSelectedYearState] = useState<string>(() =>
    isValidYearFilter(initialUrlYear) ? initialUrlYear : readStoredSelectedYear()
  );
  const setSelectedYear = useCallback((value: string) => {
    setSelectedYearState(value);
    writeStoredSelectedYear(value);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "all") {
        next.delete("year");
      } else {
        next.set("year", value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [filters, setFilters] = useState<AdvancedFilterState>({
    regions: [],
    leadOwners: [],
    priorities: [],
    bus: [],
  });
  const { toast } = useToast();
  const { isAdminOrAbove } = useUserRole();
  
  // Transition state machine for smooth expand/collapse animations
  type TransitionState = 'idle' | 'expanding' | 'expanded' | 'collapsing';
  const [transition, setTransition] = useState<TransitionState>('idle');
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<DealStage | null>(null);
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null);
  const [detailsSpacerHeight, setDetailsSpacerHeight] = useState<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollPosition = useRef<{ top: number; left: number }>({ top: 0, left: 0 });
  const TRANSITION_MS = 300;
   
   // Action item modal state — useActionItems() is lazy-mounted inside KanbanActionItemModal
   const [actionModalOpen, setActionModalOpen] = useState(false);
   const [editingActionItem, setEditingActionItem] = useState<ActionItem | null>(null);
   const [actionModalDealId, setActionModalDealId] = useState<string | null>(null);
   
   // Add Detail modal state (triggered from AnimatedStageHeaders "Add" button)
   const [addDetailOpen, setAddDetailOpen] = useState(false);

  // Prompt to fill required fields when moving between stages.
  // `mode` controls whether the dialog completes a move (terminal target) or
  // just fills the current stage's required fields before the forward move.
  const [pendingTransition, setPendingTransition] = useState<{
    dealId: string;
    targetStage: DealStage;
    missing: string[];
    mode: 'move-to-target' | 'fill-current';
    validationStage: DealStage;
  } | null>(null);

  const [pendingBackwardMove, setPendingBackwardMove] = useState<BackwardStageMoveRequest<Deal> | null>(null);


  // Handle keyboard escape to close expanded panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (transition === 'expanded' || transition === 'expanding')) {
        beginCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transition]);

  // Handle transition state changes
  useEffect(() => {
    if (transition === 'expanding') {
      const timer = setTimeout(() => setTransition('expanded'), TRANSITION_MS);
      return () => clearTimeout(timer);
    }
    if (transition === 'collapsing') {
      const timer = setTimeout(() => {
        setTransition('idle');
        setExpandedDealId(null);
        // Restore scroll position after collapse
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: savedScrollPosition.current.top,
            left: savedScrollPosition.current.left,
            behavior: 'smooth',
          });
        }
        // Handle pending expand (switching deals)
        if (pendingExpandId) {
          const nextId = pendingExpandId;
          setPendingExpandId(null);
          setTimeout(() => beginExpand(nextId), 50);
        }
      }, TRANSITION_MS);
      return () => clearTimeout(timer);
    }
  }, [transition, pendingExpandId]);

  // Begin expand animation
  const beginExpand = useCallback((dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    
    // Exit selection mode when expanding
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedDeals(new Set());
    }
    // Save scroll position before expanding
    if (scrollContainerRef.current) {
      savedScrollPosition.current = {
        top: scrollContainerRef.current.scrollTop,
        left: scrollContainerRef.current.scrollLeft,
      };
      
      // Card offset will be measured post-layout in a useEffect
    }
    setExpandedDealId(dealId);
    setExpandedStage(deal.stage as DealStage);
    setTransition('expanding');
  }, [selectionMode, deals]);

  // Begin collapse animation
  const beginCollapse = useCallback(() => {
    setTransition('collapsing');
  }, []);
  
  // Clear expanded stage after collapse animation completes
  useEffect(() => {
    if (transition === 'idle') {
      // Don't clear immediately - let state settle
      const timer = setTimeout(() => {
        if (transition === 'idle') {
          setExpandedStage(null);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [transition]);

  // Generate available options for multi-select filters
  const availableOptions = useMemo(() => {
    const regions = Array.from(new Set(deals.map(d => d.region).filter(Boolean)));
    const leadOwners = Array.from(new Set(deals.map(d => d.lead_owner).filter(Boolean)));
    const priorities = Array.from(new Set(deals.map(d => String(d.priority)).filter(p => p !== 'undefined')));
    const handoffStatuses = Array.from(new Set(deals.map(d => d.handoff_status).filter(Boolean)));
    
    return {
      regions,
      leadOwners,
      priorities,
      handoffStatuses,
    };
  }, [deals]);

  // Available fiscal years (Apr–Mar) from deals' last-updated (modified_at) dates, newest first.
  // Seed with the current FY so it's always selectable even before any deal is modified this FY.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(currentFiscalYear());
    deals.forEach((d) => {
      if (d.modified_at) {
        const dt = new Date(d.modified_at);
        if (!isNaN(dt.getTime())) years.add(dateToFiscal(dt).fy);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [deals]);

  useEffect(() => {
    const urlYear = searchParams.get("year");
    let yearToRestore = isValidYearFilter(urlYear) ? urlYear : readStoredSelectedYear();

    // One-time migration: prior versions stored a calendar year (e.g. "2026").
    // If that value doesn't match any current FY option, coerce it to the FY
    // that the Jan 1 of that calendar year belongs to (Jan–Mar → previous FY).
    if (
      yearToRestore !== "all" &&
      availableYears.length > 0 &&
      !availableYears.includes(Number(yearToRestore))
    ) {
      const coerced = dateToFiscal(new Date(Number(yearToRestore), 0, 1)).fy.toString();
      yearToRestore = coerced;
    }

    setSelectedYearState(yearToRestore);
    writeStoredSelectedYear(yearToRestore);

    const syncSelectedYear = () => {
      setSelectedYearState(readStoredSelectedYear());
    };

    window.addEventListener('pageshow', syncSelectedYear);
    window.addEventListener('focus', syncSelectedYear);
    window.addEventListener('storage', syncSelectedYear);

    return () => {
      window.removeEventListener('pageshow', syncSelectedYear);
      window.removeEventListener('focus', syncSelectedYear);
      window.removeEventListener('storage', syncSelectedYear);
    };
    // availableYears intentionally omitted — migration only needs to run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const urlYear = searchParams.get("year");
    if (!isValidYearFilter(urlYear) || urlYear === selectedYear) return;

    setSelectedYearState(urlYear);
    writeStoredSelectedYear(urlYear);
  }, [searchParams, selectedYear]);

  useEffect(() => {
    const savedFilters = localStorage.getItem(FILTER_STORAGE_KEY);
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setFilters({
          regions: Array.isArray(parsed?.regions) ? parsed.regions : [],
          leadOwners: Array.isArray(parsed?.leadOwners) ? parsed.leadOwners : [],
          priorities: Array.isArray(parsed?.priorities) ? parsed.priorities : [],
          bus: Array.isArray(parsed?.bus) ? parsed.bus : [],
        });
        setSearchTerm(parsed.searchTerm || "");
      } catch (e) {
        console.error('Failed to parse saved filters:', e);
      }
    }
  }, []);

  useEffect(() => {
    const filtersWithSearch = { ...filters, searchTerm, selectedYear };
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filtersWithSearch));
    writeStoredSelectedYear(selectedYear);
  }, [filters, searchTerm, selectedYear]);

  const filterDeals = (deals: Deal[]) => {
    return deals.filter(deal => {
      const allSearchTerms = (searchTerm || '').toLowerCase();
      const searchMatch = !allSearchTerms ||
        deal.deal_name?.toLowerCase().includes(allSearchTerms) ||
        deal.project_name?.toLowerCase().includes(allSearchTerms) ||
        deal.lead_name?.toLowerCase().includes(allSearchTerms) ||
        deal.customer_name?.toLowerCase().includes(allSearchTerms) ||
        deal.region?.toLowerCase().includes(allSearchTerms);

      // Apply multi-select filters
      const matchesRegions = filters.regions.length === 0 || filters.regions.includes(deal.region || '');
      const matchesLeadOwners = filters.leadOwners.length === 0 || filters.leadOwners.includes(deal.lead_owner || '');
      const matchesPriorities = filters.priorities.length === 0 || filters.priorities.includes(String(deal.priority || ''));

      // BU filter: deal.bu is an array; match if any overlap
      const matchesBUs = filters.bus.length === 0 || (Array.isArray(deal.bu) && deal.bu.some(b => filters.bus.includes(String(b))));

      // Fiscal year (Apr–Mar) filter based on last updated (modified_at)
      const matchesYear =
        selectedYear === "all" ||
        (deal.modified_at && dateToFiscal(new Date(deal.modified_at)).fy.toString() === selectedYear);

      return searchMatch && matchesRegions && matchesLeadOwners && matchesPriorities && matchesBUs && matchesYear;
    });
  };

  const getDealsByStage = (stage: DealStage) => {
    const filteredDeals = filterDeals(deals);
    return filteredDeals.filter(deal => deal.stage === stage);
  };

  const getVisibleStages = () => {
    const leadDeals = getDealsByStage('Lead');
    const lostDeals = getDealsByStage('Lost');
    const droppedDeals = getDealsByStage('Dropped');
    
    return DEAL_STAGES.filter(stage => {
      if (stage === 'Lead') return leadDeals.length > 0;
      if (stage === 'Lost') return lostDeals.length > 0;
      if (stage === 'Dropped') return droppedDeals.length > 0;
      return true;
    });
  };

  const onDragStart = (start: any) => {
    setDraggedDeal(start.draggableId);
  };

  const onDragEnd = async (result: DropResult) => {
    setDraggedDeal(null);
    
    if (!result.destination) return;

    const { draggableId, destination } = result;
    const newStage = destination.droppableId as DealStage;
    const deal = deals.find(d => d.id === draggableId);
    
    if (!deal || deal.stage === newStage) return;

    console.log(`Moving deal from ${deal.stage} to ${newStage}`);

    const currentStage = deal.stage as DealStage;

    // Won is closed-won; block moves out of Won (admin may only reopen to Verbal Approval).
    const gate = isTransitionAllowed(currentStage, newStage, { isAdmin: isAdminOrAbove });
    if (!gate.allowed) {
      toast({ title: "Move blocked", description: gate.reason, variant: "destructive" });
      return;
    }

    const forward = isForwardPipelineMove(currentStage, newStage);

    // Adjacency guard: pipeline moves must be one stage at a time.
    if (!isAdjacentPipelineMove(currentStage, newStage)) {
      const next = getNextPipelineStage(currentStage, newStage);
      toast({
        title: "One stage at a time",
        description: next
          ? `Move to ${getStageLabel(next)} first before reaching ${getStageLabel(newStage)}.`
          : `You can only move one pipeline stage at a time.`,
        variant: "destructive",
      });
      return;
    }


    // Backward (non-terminal) drag → confirm + ask about field handling.
    if (isBackwardPipelineMove(currentStage, newStage)) {
      setPendingBackwardMove({
        dealId: draggableId,
        deal,
        currentStage,
        targetStage: newStage,
      });
      return;
    }

    // Stage gate: when advancing along the pipeline, validate the CURRENT
    // stage's required fields (must be completed before exit). When moving
    // into a terminal stage (Won/Lost/Hold/Dropped), fall back to the target
    // stage's required fields.
    const validationStage: DealStage = TERMINAL_STAGES.includes(newStage)
      ? newStage
      : forward
        ? currentStage
        : newStage;
    const dataForCheck = forward && !TERMINAL_STAGES.includes(newStage) ? deal : { ...deal, stage: newStage };
    const fieldErrors = getFieldErrors(dataForCheck, validationStage);
    const missing = Object.keys(fieldErrors);
    if (missing.length > 0) {
      setPendingTransition({
        dealId: draggableId,
        targetStage: newStage,
        missing,
        mode: forward && !TERMINAL_STAGES.includes(newStage) ? 'fill-current' : 'move-to-target',
        validationStage,
      });
      return;
    }


    try {
      console.log(`Moving deal ${draggableId} to stage ${newStage}`);

      // Hold is a pause state — preserve the deal's existing probability so
      // the funnel does not silently zero-out the forecast when something is
      // parked. All other stages follow the stage→probability mapping.
      const updates: Partial<Deal> = {
        stage: newStage,
        probability: newStage === 'Hold'
          ? (deal.probability ?? STAGE_PROBABILITY[newStage])
          : STAGE_PROBABILITY[newStage],
      };

      await onUpdateDeal(draggableId, updates);
      
      showToastOnce({
        title: "Deal Updated",
        description: `Deal moved to ${newStage} stage`,
      });
    } catch (error) {
      console.error("Error updating deal stage:", error);
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to update deal stage"),
        variant: "destructive",
      });
    }
  };

  const handleSelectDeal = (dealId: string, checked: boolean, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    
    const newSelected = new Set(selectedDeals);
    if (checked) {
      newSelected.add(dealId);
    } else {
      newSelected.delete(dealId);
    }
    setSelectedDeals(newSelected);
  };

  const handleSelectAllInStage = (stage: DealStage, checked: boolean) => {
    const stageDeals = getDealsByStage(stage);
    const newSelected = new Set(selectedDeals);
    
    stageDeals.forEach(deal => {
      if (checked) {
        newSelected.add(deal.id);
      } else {
        newSelected.delete(deal.id);
      }
    });
    
    setSelectedDeals(newSelected);
  };

  const handleBulkDelete = () => {
    if (selectedDeals.size === 0) return;
    
    onDeleteDeals(Array.from(selectedDeals));
    setSelectedDeals(new Set());
    setSelectionMode(false);
    
    toast({
      title: "Deals deleted",
      description: `Successfully deleted ${selectedDeals.size} deals`,
    });
  };

  const handleBulkExport = () => {
    // Export logic handled by ImportExportBar
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) {
      setSelectedDeals(new Set());
    }
  };

  const handleDealCardAction = async (dealId: string, newStage: DealStage) => {
    try {
      console.log(`Card action: Moving deal ${dealId} to stage ${newStage}`);

      const existing = deals.find(d => d.id === dealId);
      if (existing) {
        const currentStage = existing.stage as DealStage;
        const gate = isTransitionAllowed(currentStage, newStage, { isAdmin: isAdminOrAbove });
        if (!gate.allowed) {
          toast({ title: "Move blocked", description: gate.reason, variant: "destructive" });
          return;
        }
        if (!isAdjacentPipelineMove(currentStage, newStage)) {
          const next = getNextPipelineStage(currentStage, newStage);
          toast({
            title: "One stage at a time",
            description: next
              ? `Move to ${getStageLabel(next)} first before reaching ${getStageLabel(newStage)}.`
              : `You can only move one pipeline stage at a time.`,
            variant: "destructive",
          });
          return;
        }
        if (isBackwardPipelineMove(currentStage, newStage)) {
          setPendingBackwardMove({
            dealId,
            deal: existing,
            currentStage,
            targetStage: newStage,
          });
          return;
        }
        const forward = isForwardPipelineMove(currentStage, newStage);
        const validationStage: DealStage = TERMINAL_STAGES.includes(newStage)
          ? newStage
          : forward
            ? currentStage
            : newStage;
        const dataForCheck = forward && !TERMINAL_STAGES.includes(newStage) ? existing : { ...existing, stage: newStage };
        const fieldErrors = getFieldErrors(dataForCheck, validationStage);
        const missing = Object.keys(fieldErrors);
        if (missing.length > 0) {
          setPendingTransition({
            dealId,
            targetStage: newStage,
            missing,
            mode: forward && !TERMINAL_STAGES.includes(newStage) ? 'fill-current' : 'move-to-target',
            validationStage,
          });
          return;
        }
      }

      // Hold preserves probability — see onDragEnd for rationale.
      const updates: Partial<Deal> = {
        stage: newStage,
        probability: newStage === 'Hold'
          ? (existing?.probability ?? STAGE_PROBABILITY[newStage])
          : STAGE_PROBABILITY[newStage],
      };

      await onUpdateDeal(dealId, updates);
      
      showToastOnce({
        title: "Deal Updated",
        description: `Deal moved to ${newStage} stage`,
      });
    } catch (error) {
      console.error("Error updating deal stage:", error);
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to update deal stage"),
        variant: "destructive",
      });
    }
  };

  // Get selected deal objects for export
  const selectedDealObjects = deals.filter(deal => selectedDeals.has(deal.id));

  const visibleStages = getVisibleStages();


  // Layout-safe scroll helper: waits for 3 animation frames before measuring
  const performLayoutSafeScroll = useCallback(() => {
    if (!scrollContainerRef.current || !expandedDealId || !expandedStage) return;

    const container = scrollContainerRef.current;
    
    // Triple rAF ensures full layout reflow after grid column changes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!container) return;

          // Measure sticky header height dynamically
          const stickyHeader = container.querySelector('.sticky.top-0');
          const stickyHeaderHeight = stickyHeader?.getBoundingClientRect().height || 65;

          // Find the stage column element
          const stageEl = container.querySelector(`[data-stage-column="${expandedStage}"]`);
          const cardEl = container.querySelector(`[data-deal-id="${expandedDealId}"]`);

          if (!stageEl) return;

          const paddingMargin = 8;

          // Horizontal: scroll so the expanded stage column is at the left edge
          let targetScrollLeft = (stageEl as HTMLElement).offsetLeft - paddingMargin;

          // Clamp horizontal scroll to valid range
          const maxScrollLeft = container.scrollWidth - container.clientWidth;
          targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));

          // Vertical: scroll so the expanded card is near the top (below sticky header)
          let targetScrollTop = 0;
          if (cardEl) {
            const cardOffsetTop = (cardEl as HTMLElement).offsetTop;
            targetScrollTop = cardOffsetTop - stickyHeaderHeight - paddingMargin;
            const maxScrollTop = container.scrollHeight - container.clientHeight;
            targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
          }


          container.scrollTo({
            left: targetScrollLeft,
            top: targetScrollTop,
            behavior: 'smooth'
          });
        });
      });
    });
  }, [expandedDealId, expandedStage]);

  // Post-layout measurement: measure expanded card's vertical offset within its stage column
  useEffect(() => {
    if ((transition === 'expanding' || transition === 'expanded') && expandedDealId && expandedStage && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const container = scrollContainerRef.current;
            if (!container) return;
            
            const cardEl = container.querySelector(`[data-deal-id="${expandedDealId}"]`);
            const stageCol = container.querySelector(`[data-stage-column="${expandedStage}"]`);
            
            if (cardEl && stageCol) {
              const stageRect = stageCol.getBoundingClientRect();
              const cardRect = cardEl.getBoundingClientRect();
              const offset = cardRect.top - stageRect.top;
              setDetailsSpacerHeight(Math.max(0, offset));
            }
          });
        });
      });
    }
  }, [transition, expandedDealId, expandedStage]);

  // Auto-scroll when expansion starts, with post-transition correction
  useEffect(() => {
    if (transition === 'expanding' && expandedStage && scrollContainerRef.current) {
      // Initial scroll after layout settles
      performLayoutSafeScroll();

      // Post-transition correction (grid animation may shift elements)
      const correctionTimer = setTimeout(() => {
        performLayoutSafeScroll();
      }, TRANSITION_MS + 50);

      return () => clearTimeout(correctionTimer);
    }
  }, [transition, expandedStage, performLayoutSafeScroll]);

   // Handle opening action item modal from expanded panel
   const handleOpenActionItemModal = (actionItem?: any) => {
     // Capture the current deal ID at the time of opening
     setActionModalDealId(expandedDealId);
     if (actionItem?.id) {
       // Convert to ActionItem type for editing
       setEditingActionItem(actionItem as ActionItem);
     } else {
       setEditingActionItem(null);
     }
     setActionModalOpen(true);
   };
 
   // Save handler now lives inside KanbanActionItemModal (lazy-mounted)
 
  // Get grid columns - insert expanded panel column when needed
  const getGridColumns = () => {
    const isInlineExpanded = (transition === 'expanded' || transition === 'expanding' || transition === 'collapsing') && expandedStage;
    
    if (isInlineExpanded) {
      const expandedIndex = visibleStages.indexOf(expandedStage);
      const beforeCount = expandedIndex;
      const afterCount = visibleStages.length - expandedIndex - 1;
      
      // Grid: [before stages] [expanded stage 280px] [details ~50%] [after stages]
      const parts: string[] = [];
      if (beforeCount > 0) parts.push(`repeat(${beforeCount}, minmax(240px, 1fr))`);
      parts.push('minmax(240px, 1fr)'); // expanded stage same as others
      parts.push('minmax(825px, 3.5fr)'); // details panel
      if (afterCount > 0) parts.push(`repeat(${afterCount}, minmax(240px, 1fr))`);
      
      return parts.join(' ');
    }
    return `repeat(${visibleStages.length}, minmax(240px, 1fr))`;
  };

  // Handle expand deal
  const handleExpandDeal = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;

    // Toggle if same deal, otherwise expand new one
    if (expandedDealId === dealId) {
      beginCollapse();
    } else if (transition === 'expanded') {
      // Already expanded with different deal - queue the new one
      setPendingExpandId(dealId);
      beginCollapse();
    } else {
      beginExpand(dealId);
    }
  };

  // Get expanded deal object
  const expandedDealObject = expandedDealId 
    ? deals.find(d => d.id === expandedDealId) 
    : null;

  // Inline expansion state
  const isInlineExpanded = (transition === 'expanded' || transition === 'expanding' || transition === 'collapsing') && expandedStage;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header with Search/Filter Bar - fixed height to align with sidebar logo divider */}
      <div className="flex-shrink-0 h-16 border-b border-border bg-background px-6 flex items-center">
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search all deal details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 transition-all hover:border-primary/50 focus:border-primary w-full"
            />
          </div>
          
          <DealsAdvancedFilter 
            filters={filters} 
            onFiltersChange={setFilters}
            availableRegions={availableOptions.regions}
            availableLeadOwners={availableOptions.leadOwners}
            availablePriorities={availableOptions.priorities}
            availableBUs={[...BU_OPTIONS]}
            availableHandoffStatuses={availableOptions.handoffStatuses}
          />

          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="h-9 w-[170px] gap-2" title="Filter by last updated fiscal year (Apr–Mar)">
              <CalendarDays className="w-4 h-4 opacity-70" />
              <SelectValue placeholder="Fiscal year" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectItem value="all">All fiscal years</SelectItem>
              {availableYears.map((y) => (
                <SelectItem key={y} value={y.toString()}>
                  {fiscalLabel(y)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(searchTerm || filters.regions.length > 0 || filters.leadOwners.length > 0 || filters.priorities.length > 0 || filters.bus.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm("");
                setFilters({
                  regions: [],
                  leadOwners: [],
                  priorities: [],
                  bus: [],
                });
              }}
              className="h-9 px-2 text-muted-foreground hover:text-foreground gap-1"
              title="Clear filters"
            >
              <X className="w-4 h-4" />
              Clear
            </Button>
          )}

          {selectionMode && selectedDeals.size > 0 && (
            <BulkActionsBar
              selectedCount={selectedDeals.size}
              onDelete={handleBulkDelete}
              onExport={handleBulkExport}
              onClearSelection={() => setSelectedDeals(new Set())}
              className="static translate-x-0 z-auto animate-none"
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label="More actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 bg-popover z-50">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggleSelectionMode(); }}>
                <CheckSquare className="w-4 h-4 mr-2" />
                {selectionMode ? "Exit selection" : "Select deals"}
              </DropdownMenuItem>
              {hasMore && onLoadAll && (
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onLoadAll(); }}>
                  <Download className="w-4 h-4 mr-2" />
                  Load all deals
                </DropdownMenuItem>
              )}
              {canArchive && onOpenArchive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onOpenArchive(); }}>
                    <ArchiveIcon className="w-4 h-4 mr-2" />
                    Archive
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {headerActions}
        </div>
      </div>

      {/* Main Content Area - single inline view */}
      <div className="flex-1 min-h-0 relative">
        <style>
          {`
            .deals-scrollbar::-webkit-scrollbar {
              width: 2px;
              height: 2px;
            }
            .deals-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .deals-scrollbar::-webkit-scrollbar-thumb {
              background: hsl(var(--border));
              border-radius: 1px;
            }
            .deals-scrollbar::-webkit-scrollbar-thumb:hover {
              background: hsl(var(--muted-foreground));
            }
          `}
        </style>

        {/* Single unified view with inline expansion */}
        <div 
          className="absolute inset-0 overflow-auto deals-scrollbar"
          ref={scrollContainerRef}
          style={{ 
            scrollbarWidth: 'thin',
            scrollbarColor: 'hsl(var(--border)) transparent',
          }}
        >
          {/* Sticky Stage Headers - scrolls horizontally with content, sticks to top on vertical scroll */}
          <div className="sticky top-0 z-20 bg-background px-3 pt-0 pb-1">
            <AnimatedStageHeaders
              visibleStages={visibleStages}
              expandedStage={expandedStage}
              transition={transition}
              selectionMode={selectionMode}
              getDealsByStage={getDealsByStage}
              selectedDeals={selectedDeals}
              onSelectAllInStage={handleSelectAllInStage}
              onCreateDeal={onCreateDeal}
              onAddDetail={() => setAddDetailOpen(true)}
            />
          </div>

          {/* Deal content grid with inline details panel */}
          <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div 
              className="grid gap-2 px-3 pt-0 pb-2 transition-all duration-300 ease-out"
              style={{ 
                gridTemplateColumns: getGridColumns()
              }}
            >
              {visibleStages.map((stage, stageIndex) => {
                const stageDeals = getDealsByStage(stage);
                const isExpandedStage = stage === expandedStage;
                
                return (
                  <div key={stage} className="contents">
                    {/* Stage column - add data attribute for DOM measurement */}
                    <div 
                      className="flex flex-col min-w-0"
                      data-stage-column={stage}
                    >
                      <Droppable droppableId={stage} isDropDisabled={!!isInlineExpanded}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              'flex-1 space-y-1.5 p-1.5 rounded-lg transition-all min-h-[400px]',
                              snapshot.isDraggingOver && 'bg-muted/50 shadow-inner'
                            )}
                          >
                            {stageDeals.map((deal, index) => {
                              const isExpandedDeal = deal.id === expandedDealId;
                              const shouldDim = isInlineExpanded && !isExpandedDeal;
                              
                              return (
                                <Draggable 
                                  key={deal.id} 
                                  draggableId={deal.id} 
                                  index={index}
                                  isDragDisabled={selectionMode || !!isInlineExpanded}
                                >
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...(provided.draggableProps as any)}
                                      {...(!selectionMode && !isInlineExpanded ? provided.dragHandleProps : {})}
                                      className="relative group"
                                      data-deal-id={deal.id}
                                    >
                                      {selectionMode && (
                                        <div className="absolute top-1.5 left-1.5 z-10">
                                          <Checkbox
                                            checked={selectedDeals.has(deal.id)}
                                            onCheckedChange={(checked) => handleSelectDeal(deal.id, Boolean(checked))}
                                            className="bg-background border-2 transition-colors h-3 w-3"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        </div>
                                      )}
                                      <DealCard
                                        deal={deal}
                                        onClick={(e) => {
                                          if (selectionMode) {
                                            handleSelectDeal(deal.id, !selectedDeals.has(deal.id), e);
                                          } else if (isInlineExpanded && !isExpandedDeal) {
                                            // Switch to this deal when clicking a dimmed card
                                            handleExpandDeal(deal.id);
                                          } else {
                                            onDealClick(deal);
                                          }
                                        }}
                                        isDragging={snapshot.isDragging}
                                        isSelected={selectedDeals.has(deal.id)}
                                        isExpanded={isExpandedDeal}
                                        isDimmed={shouldDim}
                                        selectionMode={selectionMode}
                                        onStageChange={handleDealCardAction}
                                        onExpand={handleExpandDeal}
                                      />
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                    
                    {/* Inline Details Panel - aligned with selected card via spacer */}
                    {isExpandedStage && isInlineExpanded && expandedDealObject && (
                      <div 
                        data-details-panel="true"
                        className="flex flex-col"
                        style={{ 
                          minHeight: 0,
                          height: 'fit-content',
                        }}
                      >
                        {/* Spacer to align details panel with expanded card */}
                        {detailsSpacerHeight > 0 && (
                          <div style={{ height: `${detailsSpacerHeight}px`, flexShrink: 0 }} />
                        )}
                        <InlineDetailsPanel
                          deal={expandedDealObject}
                          transition={transition}
                          onClose={beginCollapse}
                          onOpenActionItemModal={handleOpenActionItemModal}
                          addDetailOpen={addDetailOpen}
                          onAddDetailOpenChange={setAddDetailOpen}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        </div>
      </div>

       
      {/* Action Item Modal — lazy-mounted: useActionItems hook only fires when open */}
      {actionModalOpen && (
        <KanbanActionItemModal
          open={actionModalOpen}
          onOpenChange={(open) => {
            setActionModalOpen(open);
            if (!open) {
              setEditingActionItem(null);
              setActionModalDealId(null);
            }
          }}
          actionItem={editingActionItem}
          defaultModuleId={actionModalDealId || expandedDealId || undefined}
          onSaved={() => {
            setActionModalOpen(false);
            setEditingActionItem(null);
            setActionModalDealId(null);
          }}
        />
      )}

      {/* Inline required-field prompt for stage transitions */}
      <MissingFieldsDialog
        open={!!pendingTransition}
        deal={pendingTransition ? deals.find(d => d.id === pendingTransition.dealId) ?? null : null}
        targetStage={pendingTransition?.targetStage ?? null}
        validationStage={pendingTransition?.validationStage ?? null}
        mode={pendingTransition?.mode ?? 'move-to-target'}
        missingFields={pendingTransition?.missing ?? []}
        onCancel={() => setPendingTransition(null)}
        onConfirm={async (updates) => {
          if (!pendingTransition) return;
          const { dealId, targetStage, mode } = pendingTransition;
          try {
            if (mode === 'fill-current') {
              // Just save the current-stage fields; do NOT change stage yet.
              await onUpdateDeal(dealId, updates);
              setPendingTransition(null);
              toast({
                title: "Saved",
                description: `Required fields completed. You can now move the deal to ${getStageLabel(targetStage)}.`,
              });
            } else {
              await onUpdateDeal(dealId, {
                ...updates,
                stage: targetStage,
                probability: targetStage === 'Hold'
                  ? (deals.find(d => d.id === dealId)?.probability ?? STAGE_PROBABILITY[targetStage])
                  : STAGE_PROBABILITY[targetStage],
              });
              setPendingTransition(null);
              showToastOnce({
                title: "Deal Updated",
                description: `Deal moved to ${getStageLabel(targetStage)} stage`,
              });
            }
          } catch (e) {
            console.error('Error completing stage transition:', e);
            toast({
              title: "Error",
              description: getErrorMessage(e, "Failed to update deal stage"),
              variant: "destructive",
            });
          }
        }}
      />

      {/* Backward drag confirmation */}
      <BackwardStageConfirmDialog
        open={!!pendingBackwardMove}
        currentStage={pendingBackwardMove?.currentStage ?? null}
        targetStage={pendingBackwardMove?.targetStage ?? null}
        deal={pendingBackwardMove?.deal ?? null}
        onCancel={() => setPendingBackwardMove(null)}
        onConfirm={async (choice) => {
          if (!pendingBackwardMove) return;
          const { dealId, currentStage, targetStage, deal } = pendingBackwardMove;
          setPendingBackwardMove(null);
          const updates = buildBackwardMoveUpdates(currentStage, targetStage, choice, deal);
          try {
            await onUpdateDeal(dealId, {
              ...updates,
            });
            showToastOnce({
              title: "Deal Updated",
              description: `Deal moved back to ${getStageLabel(targetStage)} stage`,
            });
          } catch (e) {
            console.error('Error moving deal backward:', e);
            toast({
              title: "Error",
              description: getErrorMessage(e, "Failed to update deal stage"),
              variant: "destructive",
            });
          }
        }}
      />


    </div>
  );
};
