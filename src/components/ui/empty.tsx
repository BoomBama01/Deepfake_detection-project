import * as React from "react";
import { cn } from "./button";

const Empty = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      ref={undefined}
      className={cn("flex flex-col items-center justify-center py-12 text-center", className)}
      {...props}
    />
  );
};

Empty.displayName = "Empty";

export { Empty };
