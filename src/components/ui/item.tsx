import * as React from "react";
import { cn } from "./button";

const Item = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex items-center gap-4 rounded-md border border-transparent bg-transparent px-4 py-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Item.displayName = "Item";

export { Item };
