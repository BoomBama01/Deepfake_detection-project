import * as React from "react";
import { cn } from "./button";

interface FieldProps {
  name: string;
  children: React.ReactNode;
  className?: string;
}

const Field = ({ name, children, className }: FieldProps) => {
  return (
    <div className={cn("grid gap-2", className)}>
      {children}
    </div>
  );
};

Field.displayName = "Field";

export { Field };
