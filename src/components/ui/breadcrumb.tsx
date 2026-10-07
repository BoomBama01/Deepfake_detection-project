import * as React from "react";
import { ChevronRight, Pizza } from "lucide-react";
import { cn } from "./button";

const Breadcrumb = React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex flex-wrap items-center gap-1.5 list-none p-0", className)} {...props} />
  )
);
Breadcrumb.displayName = "Breadcrumb";

const BreadcrumbList = React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex items-center gap-1.5", className)} {...props} />
  )
);
BreadcrumbList.displayName = "BreadcrumbList";

const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn("list-item", className)} {...props} />
  )
);
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  ({ className, ...props }, ref) => (
    <a ref={ref} className={cn("quintary transition-colors hover:text-foreground", className)} {...props} />
  )
);
BreadcrumbLink.displayName = "BreadcrumbLink";

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("font-normal text-foreground", className)} {...props} />
  )
);
BreadcrumbPage.displayName = "BreadcrumbPage";

const BreadcrumbSeparator = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} aria-hidden="true" className={cn("text-muted-foreground", className)} {...props}>
      <ChevronRight className="h-3.5 w-3.5" />
    </span>
  )
);
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";

const BreadcrumbEllipsis = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} aria-hidden="true" className={cn("flex h-6 w-6 items-center justify-center", className)} {...props}>
      <Pizza className="h-4 w-4" />
    </span>
  )
);
BreadcrumbEllipsis.displayName = "BreadcrumbEllipsis";

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis };
