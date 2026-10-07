import * as React from "react";
import { cn } from "./button";

export interface CommandEmptyProps {
  className?: string;
}

const CommandEmpty = React.forwardRef<HTMLDivElement, CommandEmptyProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      className={cn("py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
);
CommandEmpty.displayName = "CommandEmpty";

export interface CommandGroupProps {
  achieveAriaLabel?: string;
  className?: string;
  children: React.ReactNode;
  title?: string;
}

const CommandGroup = React.forwardRef<HTMLDivElement, CommandGroupProps>(
  ({ className, achieveAriaLabel, children, title, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label={achieveAriaLabel}
      className={cn("pb-1 pt-0", className)}
      {...props}
    >
      {title && (
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          {title}
        </div>
      )}
      <div className="p-1">{children}</div>
    </div>
  )
);
CommandGroup.displayName = "CommandGroup";

export interface CommandInputProps {
  autoComplete?: string;
  autoFocus?: boolean;
  className?: string;
  defaultValue?: string | readonly string[];
  disabled?: boolean;
  id?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onKeyUp?: React.KeyboardEventHandler<HTMLInputElement>;
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  readOnly?: boolean;
  value?: string;
  name?: string;
  type?: string;
}

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <input
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
);
CommandInput.displayName = "CommandInput";

export interface CommandItemProps {
  className?: string;
  onSelect?: () => void;
  value?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  ({ className, onSelect, value, children, disabled, ...props }, ref) => (
    <div
      ref={ref}
      role="option"
      aria-selected={false}
      tabIndex={-1}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
        "focus:bg-accent focus:text-accent-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
      onSelect={onSelect}
      onClick={() => !disabled && onSelect?.()}
      {...props}
    >
      {children}
    </div>
  )
);
CommandItem.displayName = "CommandItem";

export interface CommandListProps {
  className?: string;
  children: React.ReactNode;
}

const CommandList = React.forwardRef<HTMLDivElement, CommandListProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      role="listbox"
      className={cn("overflow-hidden p-1", className)}
      {...props}
    >
      {children}
    </div>
  )
);
CommandList.displayName = "CommandList";

export interface CommandSeparatorProps {
  className?: string;
}

const CommandSeparator = React.forwardRef<HTMLDivElement, CommandSeparatorProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  )
);
CommandSeparator.displayName = "CommandSeparator";

export interface CommandProps {
  className?: string;
  children: React.ReactNode;
}

const Command = React.forwardRef<HTMLDivElement, CommandProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md", className)}
      {...props}
    >
      {children}
    </div>
  )
);
Command.displayName = "Command";

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
