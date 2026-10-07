import { Toaster as Sonner } from "sonner";
import * as React from "react";
import { cn } from "./button";

const Toaster = React.forwardRef<
  React.ElementRef<typeof Sonner>,
  React.ComponentPropsWithoutRef<typeof Sonner>
>(({ className, ...props }, ref) => (
  <Sonner
    ref={ref}
    className={cn(
      "toaster group",
      className
    )}
    {...props}
  />
));
Toaster.displayName = "Toaster";

export { Toaster };
