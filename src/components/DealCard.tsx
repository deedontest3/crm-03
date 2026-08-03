import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Deal, DealStage, STAGE_COLORS } from "@/types/deal";
import { format } from "date-fns";
import { XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface DealCardProps {
  deal: Deal;
  onClick: (e?: React.MouseEvent) => void;
  isDragging?: boolean;
  isSelected?: boolean;
  isExpanded?: boolean;
  isDimmed?: boolean;
  selectionMode?: boolean;
  onDelete?: (dealId: string) => void;
  onStageChange?: (dealId: string, newStage: DealStage) => void;
  onExpand?: (dealId: string) => void;
}

// Map stage to left border color
const STAGE_BORDER_COLORS: Record<DealStage, string> = {
  Lead: 'border-l-[hsl(239,45%,55%)]',
  Discussions: 'border-l-[hsl(180,45%,45%)]',
  Qualified: 'border-l-[hsl(188,50%,40%)]',
  RFQ: 'border-l-[hsl(204,30%,50%)]',
  Offered: 'border-l-[hsl(30,55%,45%)]',
  Negotiation: 'border-l-[hsl(280,45%,50%)]',
  'Verbal Approval': 'border-l-[hsl(160,50%,40%)]',
  Won: 'border-l-[hsl(142,50%,40%)]',
  Lost: 'border-l-[hsl(0,50%,50%)]',
  Hold: 'border-l-[hsl(45,80%,45%)]',
  Dropped: 'border-l-[hsl(0,0%,50%)]',
};

// Map stage to card background tint
const STAGE_CARD_TINTS: Record<DealStage, string> = {
  Lead: 'bg-[hsl(239,45%,97%)]',
  Discussions: 'bg-[hsl(180,50%,97%)]',
  Qualified: 'bg-[hsl(188,55%,97%)]',
  RFQ: 'bg-[hsl(204,35%,97%)]',
  Offered: 'bg-[hsl(30,55%,97%)]',
  Negotiation: 'bg-[hsl(280,45%,97%)]',
  'Verbal Approval': 'bg-[hsl(160,50%,97%)]',
  Won: 'bg-[hsl(142,50%,96%)]',
  Lost: 'bg-[hsl(0,50%,98%)]',
  Hold: 'bg-[hsl(45,80%,97%)]',
  Dropped: 'bg-[hsl(0,0%,97%)]',
};

export const DealCard = ({ 
  deal, 
  onClick, 
  isDragging, 
  isSelected, 
  isExpanded,
  isDimmed,
  selectionMode, 
  onDelete, 
  onStageChange,
  onExpand
}: DealCardProps) => {
  const formatCurrency = (amount: number, currency: string = 'EUR') => {
    const symbols = { USD: '$', EUR: '€', INR: '₹' };
    return `${symbols[currency as keyof typeof symbols] || '€'}${amount.toLocaleString()}`;
  };

  const handleMoveToDropped = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onStageChange) {
      onStageChange(deal.id, 'Dropped');
    }
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpand) {
      onExpand(deal.id);
    }
  };

  const stageBorderColor = STAGE_BORDER_COLORS[deal.stage as DealStage] || 'border-l-border';
  const stageCardTint = STAGE_CARD_TINTS[deal.stage as DealStage] || '';

  return (
    <Card
      className={cn(
        `deal-card group cursor-pointer transition-all duration-300 border-l-3 border-border/40`,
        !isExpanded && 'hover:shadow-lg hover:-translate-y-0.5',
        stageBorderColor,
        stageCardTint,
        isDragging && 'opacity-50 rotate-2 scale-105',
        isSelected && 'ring-2 ring-primary bg-primary/5 border-primary',
        selectionMode && 'pl-8',
        isExpanded && 'ring-2 ring-primary shadow-md border-primary z-10',
        isDimmed && 'deal-card-dimmed'
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-1.5 pt-3 px-3">
        <CardTitle className="text-sm font-semibold text-foreground leading-tight break-words">
          {deal.project_name || 'Untitled Deal'}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="pt-0 pb-3 px-3 space-y-1.5 text-sm">
        {/* Customer Name */}
        {deal.customer_name && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70 w-14 shrink-0">Account :</span>
            <p className="text-sm font-medium text-foreground truncate">
              {deal.customer_name}
            </p>
          </div>
        )}
        
        {/* Lead Name */}
        {deal.lead_name && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70 w-14 shrink-0">Contact :</span>
            <p className="text-xs text-muted-foreground truncate">
              {deal.lead_name}
            </p>
          </div>
        )}
        
        {/* Lead Owner */}
        {deal.lead_owner && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70 w-14 shrink-0">Owner :</span>
            <p className="text-xs text-muted-foreground truncate">
              {deal.lead_owner}
            </p>
          </div>
        )}
        
        {/* Probability */}
        {deal.probability !== undefined && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground/70">Probability</span>
            <div className="flex items-center gap-2">
              <div className="w-12 bg-muted/50 rounded-full h-1.5">
                <div
                  className="rounded-full h-1.5 transition-all duration-300"
                  style={{
                    width: `${Math.max(deal.probability || 0, 2)}%`,
                    backgroundColor: `hsl(142, ${70 + ((deal.probability || 0) / 100) * 20}%, ${90 - ((deal.probability || 0) / 100) * 45}%)`,
                  }}
                />
              </div>
              <span className="text-xs font-medium text-foreground">{deal.probability}%</span>
            </div>
          </div>
        )}
        
        {/* Contract Value */}
        {deal.total_contract_value && (
          <div className="flex items-center justify-between pt-1.5 border-t border-border/20">
            <span className="text-xs text-muted-foreground/70">Value</span>
            <p className="font-semibold text-base text-foreground">
              {formatCurrency(deal.total_contract_value, deal.currency_type)}
            </p>
          </div>
        )}
        
        {/* Target Closure date */}
        {deal.expected_closing_date && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/70">Close</span>
            <p className="text-xs text-muted-foreground">
              {(() => {
                try {
                  return format(new Date(deal.expected_closing_date), 'dd/MM/yyyy');
                } catch {
                  return 'Invalid date';
                }
              })()}
            </p>
          </div>
        )}
        
      </CardContent>
      
      {/* Footer with actions */}
      <CardFooter className="px-3 py-1 border-t border-border/20 flex items-center justify-between min-h-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 whitespace-nowrap">
          <span>{deal.modified_at ? (() => {
            try {
              return format(new Date(deal.modified_at), 'MMM dd');
            } catch {
              return 'Unknown';
            }
          })() : 'Unknown'}</span>
          
          {deal.priority && (
            <Badge 
              variant={deal.priority <= 2 ? 'destructive' : deal.priority === 3 ? 'default' : 'secondary'}
              className="text-[10px] px-1.5 py-0 font-medium h-4"
            >
              P{deal.priority}
            </Badge>
          )}
          
          {deal.bu && deal.bu.length > 0 && (
            <Badge 
              variant="outline"
              className="text-[10px] px-1.5 py-0 font-medium h-4 border-border/60 text-muted-foreground/80"
            >
              {deal.bu.join(', ')}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-0.5">
          {!selectionMode && deal.stage === 'Offered' && onStageChange && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleMoveToDropped}
              className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-1 h-6 w-6 hover:bg-orange-100 text-orange-500 hover:text-orange-600"
              aria-label="Move deal to Dropped"
              title="Move to Dropped"
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          )}
          {!selectionMode && onExpand && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExpand}
              className="transition-all duration-200 px-1.5 h-6 gap-1 border border-border hover:bg-primary/10 hover:border-primary text-muted-foreground hover:text-primary"
              aria-label="View deal details"
              title="View details"
            >
              <Info className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};
