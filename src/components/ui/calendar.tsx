import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronDown, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

type View = "days" | "months" | "years";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS_PER_PAGE = 12;

const getDateFromSelection = (selected: CalendarProps["selected"]) => {
  if (selected instanceof Date) return selected;
  if (Array.isArray(selected) && selected[0] instanceof Date) return selected[0];
  if (
    selected &&
    typeof selected === "object" &&
    "from" in selected &&
    selected.from instanceof Date
  ) {
    return selected.from;
  }
  return undefined;
};

const navBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  month: monthProp,
  defaultMonth,
  onMonthChange,
  fromYear,
  toYear,
  ...props
}: CalendarProps) {
  const [view, setView] = React.useState<View>("days");
  const selectedDate = getDateFromSelection(props.selected);
  const [internalMonth, setInternalMonth] = React.useState<Date>(
    monthProp ?? defaultMonth ?? selectedDate ?? new Date()
  );
  const month = monthProp ?? internalMonth;

  const minYear = fromYear ?? 1900;
  const maxYear = Math.max(toYear ?? 2100, minYear);

  // Decade page for years view
  const [yearPageStart, setYearPageStart] = React.useState(
    Math.floor(month.getFullYear() / YEARS_PER_PAGE) * YEARS_PER_PAGE
  );

  React.useEffect(() => {
    if (view === "years") {
      setYearPageStart(
        Math.floor(month.getFullYear() / YEARS_PER_PAGE) * YEARS_PER_PAGE
      );
    }
  }, [view, month]);

  React.useEffect(() => {
    if (monthProp === undefined && selectedDate) {
      setInternalMonth(
        new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate?.getTime()]);

  const changeMonth = React.useCallback(
    (next: Date) => {
      if (monthProp === undefined) setInternalMonth(next);
      onMonthChange?.(next);
    },
    [monthProp, onMonthChange]
  );

  const stepMonth = (offset: number) => {
    changeMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  };

  const pickMonth = (m: number) => {
    changeMonth(new Date(month.getFullYear(), m, 1));
    setView("days");
  };

  const pickYear = (y: number) => {
    changeMonth(new Date(y, month.getMonth(), 1));
    setView("months");
  };

  const pageDecade = (dir: number) => {
    setYearPageStart((s) => {
      const next = s + dir * YEARS_PER_PAGE;
      const clamped = Math.min(
        Math.max(next, Math.floor(minYear / YEARS_PER_PAGE) * YEARS_PER_PAGE),
        Math.floor(maxYear / YEARS_PER_PAGE) * YEARS_PER_PAGE
      );
      return clamped;
    });
  };

  const onSelectAny = (props as any).onSelect as
    | ((...args: any[]) => void)
    | undefined;

  const canClear =
    props.mode === "single" && !!selectedDate && typeof onSelectAny === "function";

  const handleClear = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onSelectAny?.(undefined, undefined, {}, e);
    },
    [onSelectAny]
  );

  const container = "w-[260px] p-2 pointer-events-auto";

  // DAYS VIEW HEADER
  const renderDaysHeader = () => (
    <div className="flex h-9 items-center justify-between px-1">
      <button
        type="button"
        onClick={() => stepMonth(-1)}
        className={navBtn}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setView("months")}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label="Select month and year"
      >
        {format(month, "MMMM yyyy")}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      <button
        type="button"
        onClick={() => stepMonth(1)}
        className={navBtn}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  // MONTHS VIEW
  if (view === "months") {
    return (
      <div className={cn(container, className)}>
        <div className="flex h-9 items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setView("days")}
            className={navBtn}
            aria-label="Back to days"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("years")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Select year"
          >
            {month.getFullYear()}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
          <span className="h-7 w-7" />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {MONTHS_SHORT.map((label, idx) => {
            const isSelected =
              idx === month.getMonth() &&
              (!selectedDate || selectedDate.getFullYear() === month.getFullYear());
            const isCurrent = idx === month.getMonth();
            return (
              <button
                key={label}
                type="button"
                onClick={() => pickMonth(idx)}
                className={cn(
                  "h-9 rounded-md text-sm font-normal text-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                  isCurrent && "bg-accent/60",
                  isSelected &&
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                aria-label={MONTHS_LONG[idx]}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // YEARS VIEW
  if (view === "years") {
    const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i);
    const rangeLabel = `${years[0]} – ${years[years.length - 1]}`;
    return (
      <div className={cn(container, className)}>
        <div className="flex h-9 items-center justify-between px-1">
          <button
            type="button"
            onClick={() => pageDecade(-1)}
            className={navBtn}
            aria-label="Previous years"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("months")}
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {rangeLabel}
          </button>
          <button
            type="button"
            onClick={() => pageDecade(1)}
            className={navBtn}
            aria-label="Next years"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {years.map((y) => {
            const disabled = y < minYear || y > maxYear;
            const isSelected = y === month.getFullYear();
            return (
              <button
                key={y}
                type="button"
                disabled={disabled}
                onClick={() => pickYear(y)}
                className={cn(
                  "h-9 rounded-md text-sm font-normal text-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                  isSelected &&
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  disabled && "opacity-40 pointer-events-none"
                )}
              >
                {y}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // DAYS VIEW
  return (
    <div className={cn(container, className)}>
      {renderDaysHeader()}
      <DayPicker
        showOutsideDays={showOutsideDays}
        month={month}
        onMonthChange={changeMonth}
        fromYear={fromYear}
        toYear={toYear}
        className="p-0"
        classNames={{
          months: "flex flex-col",
          month: "space-y-1",
          caption: "hidden",
          caption_label: "hidden",
          nav: "hidden",
          nav_button: "hidden",
          nav_button_previous: "hidden",
          nav_button_next: "hidden",
          table: "w-full border-collapse",
          head_row: "flex",
          head_cell:
            "text-muted-foreground w-8 font-normal text-[0.7rem] uppercase tracking-wide",
          row: "flex w-full mt-1",
          cell: "h-8 w-8 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
          day: "inline-flex h-8 w-8 items-center justify-center rounded-md p-0 text-sm font-normal text-foreground hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100 transition-colors",
          day_range_end: "day-range-end",
          day_selected:
            "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
          day_today: "bg-accent text-accent-foreground",
          day_outside:
            "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
          day_disabled: "text-muted-foreground opacity-50",
          day_range_middle:
            "aria-selected:bg-accent aria-selected:text-accent-foreground",
          day_hidden: "invisible",
          ...classNames,
        }}
        {...props}
      />
      {canClear && (
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={handleClear}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
