import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/components/ui/button";

interface DisclaimerProps {
  className?: string;
  compact?: boolean;
}

export const Disclaimer: React.FC<DisclaimerProps> = ({ className, compact }) => {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground",
        compact && "p-2 text-xs",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 text-amber-500 shrink-0" />
        <div>
          <p className="font-medium text-foreground text-xs uppercase tracking-wider">
            Disclaimer
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            Results are probabilistic and may be wrong. Do not use as sole evidence.
            No detector is 100% accurate — always corroborate with human judgement
            and other sources.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Disclaimer;
