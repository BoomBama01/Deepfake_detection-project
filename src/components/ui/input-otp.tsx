import * as React from "react";
import { cn } from "./button";

interface InputOTPProps {
  className?: string;
  children?: React.ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const InputOTP = React.forwardRef<HTMLDivElement, InputOTPProps>(
  ({ className, children, value, onChange, maxLength, disabled, onKeyDown, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "display: flex items-center gap-1",
      className
    )}
    {...props}
  />
));
InputOTP.displayName = "InputOTP";

const InputOTPGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-1", className)}
    {...props}
  />
));
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center", className)}
    {...props}
  >
    <div className="w-2 h-5" />
  </div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

const InputOTPSlot = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithRef<"input"> & {
    index: number;
  }
>(({ className, index, ...props }, ref) => {
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    setValue(String(props.value || ""));
  }, [props.value]);

  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        "flex h-9 w-9 items-center justify-center border border-input bg-transparent text-sm font-medium text-center outline-none transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      onClick={(e) => {
        (e.target as HTMLInputElement).select();
      }}
      value={value}
    />
  );
});
InputOTPSlot.displayName = "InputOTPSlot";

export {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
};
