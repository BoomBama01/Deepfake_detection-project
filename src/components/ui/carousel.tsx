import * as React from "react";
import { cn } from "./button";

export interface CarouselProps {
  className?: string;
  children?: React.ReactNode;
}

const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Carousel.displayName = "Carousel";

export interface CarouselContentProps {
  className?: string;
  children?: React.ReactNode;
}

const CarouselContent = React.forwardRef<HTMLDivElement, CarouselContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("overflow-hidden flex w-full", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CarouselContent.displayName = "CarouselContent";

export interface CarouselItemProps {
  className?: string;
  children?: React.ReactNode;
}

const CarouselItem = React.forwardRef<HTMLDivElement, CarouselItemProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("min-w-0 shrink-0 w-full", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CarouselItem.displayName = "CarouselItem";

export { Carousel, CarouselContent, CarouselItem };
