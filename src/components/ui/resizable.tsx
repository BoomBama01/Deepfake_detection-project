import * as React from "react";
import { cn } from "./button";

interface ResizableProps {
  className?: string;
  children?: React.ReactNode;
}

const Resizable = ({ className, children, ...props }: ResizableProps) => (
  <div className={cn("relative", className)} {...props}>
    {children}
  </div>
);
Resizable.displayName = "Resizable";

interface ResizableHandleProps {
  className?: string;
  side?: "left" | "right" | "top" | "bottom";
  children?: React.ReactNode;
}

const ResizableHandle = React.forwardRef<HTMLDivElement, ResizableHandleProps>(
  ({ className, side = "right", children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "absolute bg-border hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        side === "right" || side === "left" ? "top-0 bottom-0 w-1 cursor-col-resize" : "left-0 right-0 h-1 cursor-row-resize",
        side === "left" && "left-0",
        side === "right" && "right-0",
        side === "top" && "top-0",
        side === "bottom" && "bottom-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
ResizableHandle.displayName = "ResizableHandle";

export { Resizable, ResizableHandle };
