import * as React from "react";
import { useEmblaCarousel, type EmblaCarouselType } from "embla-carousel-react";
import { cn } from "./button";

type CarouselApi = EmblaCarouselType;

type CarouselOptions = EmblaCarouselType["options"];

type CarouselPlugin = EmblaCarouselType["plugins"];

type UseEmblaCarouselType = {
  api: CarouselApi;
  scrollNext: () => void;
  scrollPrev: () => void;
  canScrollNext: boolean;
  canScrollPrev: boolean;
};

export interface CarouselProps {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
}

const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  ({ orientation = "horizontal", opts, plugins, setApi, className, children, ...props }, ref) => {
    const emblaRoot = React.useMemo(() => new EmblaCarouselType(undefined, opts, plugins), [opts, plugins]);
    const api = emblaRoot.api();

    React.useEffect(() => {
      setApi?.(api);
    }, [api, setApi]);

    return (
      <div
        ref={ref}
        className={cn("relative", className)}
        onMouseDown={api.lock}
        onMouseUp={api.unlock}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Carousel.displayName = "Carousel";

const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { emblaRef, type } = React.useContext(CarouselContext);
    const orientation = type === "vertical" ? "vertical" : "horizontal";

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden",
          orientation === "horizontal" ? "flex" : "flex flex-col",
          className
        )}
        {...props}
      />
    );
  }
);
CarouselContent.displayName = "CarouselContent";

const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { emblaRef, type } = React.useContext(CarouselContext);
    const orientation = type === "vertical" ? "vertical" : "horizontal";

    return (
      <div
        ref={ref}
        className={cn(
          "flex-[0_0_100%] min-w-0 min-h-0",
          orientation === "horizontal" ? "w-full" : "h-full",
          className
        )}
        {...props}
      />
    );
  }
);
CarouselItem.displayName = "CarouselItem";

const CarouselContext = React.createContext<{
  emblaRef: React.RefObject<HTMLDivElement | null>;
  type: "horizontal" | "vertical";
} | null>(null);

const CarouselProvider = Carousel;

export { Carousel, CarouselContent, CarouselItem };
