import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      classNames={{
        toast: "cursor-pointer group",
        description: "text-muted-foreground group-hover:text-foreground",
        actionButton:
          "data-[state=loading]:text-muted-foreground group-data-[variant=default]:text-primary group-data-[variant=success]:text-green-500 group-data-[variant=error]:text-destructive",
        cancelButton:
          "data-[state=loading]:text-muted-foreground group-data-[variant=default]:text-muted-foreground group-data-[variant=success]:text-muted-foreground group-data-[variant=error]:text-muted-foreground",
      }}
      {...props}
    />
  );
};

export { Toaster };
