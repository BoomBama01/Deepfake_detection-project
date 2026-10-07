import * as React from "react";
import { cn } from "./button";

const Kbd = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      "inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
      className
    )}
    {...props}
  />
));
Kbd.displayName = "Kbd";

export { Kbd };
