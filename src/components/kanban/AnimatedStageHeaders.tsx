import { useMemo } from "react";
import { DealStage, STAGE_COLORS, STAGE_BG_COLORS, getStageLabel } from "@/types/deal";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type TransitionState = 'idle' | 'expanding' | 'expanded' | 'collapsing';

interface AnimatedStageHeadersProps {
  visibleStages: DealStage[];
  expandedStage: DealStage | null;
  transition: TransitionState;
  selectionMode: boolean;
  getDealsByStage: (stage: DealStage) => { id: string }[];
  selectedDeals: Set<string>;
  onSelectAllInStage: (stage: DealStage, checked: boolean) => void;
  onCreateDeal: (stage: DealStage) => void;
  onAddDetail?: () => void;
}

export function AnimatedStageHeaders({
  visibleStages,
  expandedStage,
  transition,
  selectionMode,
  getDealsByStage,
  selectedDeals,
  onSelectAllInStage,
  onCreateDeal,
  onAddDetail,
}: AnimatedStageHeadersProps) {
  const isExpanding = transition === 'expanding';
  const isCollapsing = transition === 'collapsing';
  const isExpanded = transition === 'expanded';
  const isIdle = transition === 'idle';
  
  // Find the index of the expanded stage
  const expandedStageIndex = expandedStage 
    ? visibleStages.indexOf(expandedStage) 
    : -1;

  // Grid columns: when expanded, add a details column after the expanded stage
  const gridStyle = useMemo(() => {
    if ((isExpanded || isExpanding || isCollapsing) && expandedStage) {
      const expandedIndex = visibleStages.indexOf(expandedStage);
      const beforeCount = expandedIndex;
      const afterCount = visibleStages.length - expandedIndex - 1;
      
      // Grid: [before stages] [expanded stage 280px] [details ~60%] [after stages]
      const parts: string[] = [];
      if (beforeCount > 0) parts.push(`repeat(${beforeCount}, minmax(240px, 1fr))`);
      parts.push('minmax(240px, 1fr)'); // expanded stage same as others
      parts.push('minmax(825px, 3.5fr)'); // details panel
      if (afterCount > 0) parts.push(`repeat(${afterCount}, minmax(240px, 1fr))`);
      
      return {
        display: 'grid',
        gridTemplateColumns: parts.join(' '),
        gap: '0.5rem',
      };
    }
    // Normal grid for all stages
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${visibleStages.length}, minmax(240px, 1fr))`,
      gap: '0.5rem',
    };
  }, [isExpanded, isExpanding, isCollapsing, expandedStage, visibleStages]);

  return (
    <div 
      className="stage-header-container transition-all duration-300" 
      style={gridStyle}
    >
      {visibleStages.map((stage, stageIndex) => {
        const stageDeals = getDealsByStage(stage);
        const selectedInStage = stageDeals.filter(deal => selectedDeals.has(deal.id)).length;
        const allSelected = selectedInStage === stageDeals.length && stageDeals.length > 0;
        
        const isActiveStage = stage === expandedStage;
        
        return (
          <div key={stage} className="contents">
            <div
              className={cn(
                'stage-header-item p-2 rounded-lg border transition-all duration-300',
                STAGE_BG_COLORS[stage],
                STAGE_COLORS[stage],
                isActiveStage && (isExpanding || isExpanded || isCollapsing) && 'flex-shrink-0',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {selectionMode && (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => onSelectAllInStage(stage, Boolean(checked))}
                      className="transition-colors flex-shrink-0 h-3 w-3"
                    />
                  )}
                  <h3 className="font-semibold text-sm truncate text-foreground">{getStageLabel(stage)}</h3>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-medium whitespace-nowrap">
                    {stageDeals.length}
                    {selectionMode && selectedInStage > 0 && (
                      <span className="text-primary ml-1">({selectedInStage})</span>
                    )}
                  </span>
                  {stage === 'Lead' && !isActiveStage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onCreateDeal(stage)}
                      className="hover-scale flex-shrink-0 p-1 h-6 w-6"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            
            {/* Details Header - inserted after expanded stage */}
            {isActiveStage && (isExpanding || isExpanded || isCollapsing) && (
              <div 
                className={cn(
                  'details-header p-2 rounded-lg border bg-muted/30 border-border transition-all duration-300',
                  isCollapsing && 'collapsing'
                )}
              >
                  <div className="group/details flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-muted-foreground">Details</h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAddDetail?.()}
                      className="h-7 px-2 text-sm font-semibold text-muted-foreground hover:text-foreground opacity-0 group-hover/details:opacity-100 transition-opacity"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add
                    </Button>
                  </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
