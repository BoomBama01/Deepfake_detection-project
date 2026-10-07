import * as React from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, isSameMonth, isToday } from "date-fns";
import { cn } from "./button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CalendarProps {
  className?: string;
  selected?: Date | Date[];
  onSelect?: (date: Date) => void;
  disabled?: boolean;
}

const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(
  ({ className, selected, onSelect, disabled, ...props }, ref) => {
    const [currentMonth, setCurrentMonth] = React.useState(() => {
      const d = selected && Array.isArray(selected) ? selected[0] : (selected ?? new Date());
      return startOfMonth(d);
    });

    const weeks = React.useMemo(() => {
      const weeks: Date[][] = [];
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      const startDate = startOfMonth(monthStart);
      const endDate = endOfMonth(monthEnd);
      let row: Date[] = [];
      let cursor = startDate;

      while (cursor <= endDate) {
        if (cursor.getDay() === 0) row = [];
        row.push(cursor);
        if (cursor.getDay() === 6) weeks.push(row);
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }

      if (row.length > 0 && row[row.length - 1].getDay() !== 6) {
        const remainingDays = 6 - row[row.length - 1].getDate();
        for (let i = 1; i <= remainingDays; i++) {
          row.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i));
        }
        weeks.push(row);
      }

      return weeks;
    }, [currentMonth]);

    const isSelected = (date: Date) => {
      if (!selected) return false;
      if (Array.isArray(selected)) {
        return selected.some(s => isSameMonth(s, date));
      }
      return isSameMonth(selected, date);
    };

    return (
      <div
        ref={ref}
        className={cn("border rounded-lg p-4", className)}
        {...props}
      >
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-muted rounded"
            disabled={disabled}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-sm font-medium"
            >
              {format(currentMonth, "MMMM yyyy")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-muted rounded"
            disabled={disabled}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => (
            <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
              {day}
            </div>
          ))}
          {weeks.map((week, weekIdx) =>
            week.map((date, dayIdx) => {
              const sel = isSelected(date);
              return (
                <button
                  key={weekIdx + "-" + dayIdx}
                  type="button"
                  onClick={() => !disabled && onSelect?.(date)}
                  disabled={disabled}
                  className={cn(
                    "h-8 w-8 p-0 text-sm rounded flex items-center justify-center transition-colors",
                    sel ? "bg-primary text-primary-foreground rounded-full hover:bg-primary/90" : "hover:bg-muted rounded-full",
                    isToday(date) && "bg-muted text-foreground rounded-full"
                  )}
                >
                  {format(date, "d")}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }
);
Calendar.displayName = "Calendar";

export { Calendar };
