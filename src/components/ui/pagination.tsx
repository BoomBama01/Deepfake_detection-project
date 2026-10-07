import * as React from "react";
import { cn } from "./button";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";

interface PaginationProps {
  className?: string;
  children?: React.ReactNode;
}

const Pagination = ({ className, children, ...props }: PaginationProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);
Pagination.displayName = "Pagination";

interface PaginationLinkProps {
  className?: string;
  isActive?: boolean;
  isEllipsis?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}

const PaginationLink = React.forwardRef<HTMLButtonElement, PaginationLinkProps>(
  ({ className, isActive, isEllipsis, onClick, children, ...props }, ref) => {
  if (isEllipsis) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn("flex h-7 w-7 items-center justify-center rounded-md text-sm", className)}
        disabled
        {...props}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
});
PaginationLink.displayName = "PaginationLink";

const PaginationPrevious = React.forwardRef<HTMLButtonElement, PaginationLinkProps>(
  ({ className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" />
      <span className="sr-only">Previous page</span>
      {children}
    </button>
  )
);
PaginationPrevious.displayName = "PaginationPrevious";

const PaginationNext = React.forwardRef<HTMLButtonElement, PaginationLinkProps>(
  ({ className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      <ChevronRight className="h-4 w-4" />
      <span className="sr-only">Next page</span>
      {children}
    </button>
  )
);
PaginationNext.displayName = "PaginationNext";

const PaginationEllipsis = ({ className, ...props }: PaginationLinkProps) => (
  <span className={cn("flex h-7 w-7 items-center justify-center rounded-md text-sm", className)} {...props}>
    <Ellipsis className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

const PaginationList = ({ className, children, ...props }: PaginationProps) => (
  <div className={cn("flex flex-row gap-1", className)} {...props}>
    {children}
  </div>
);
PaginationList.displayName = "PaginationList";

const PaginationPage = ({ className, children, ...props }: PaginationProps) => (
  <div className={cn("", className)} {...props}>
    {children}
  </div>
);
PaginationPage.displayName = "PaginationPage";

export {
  Pagination,
  PaginationList,
  PaginationPage,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
