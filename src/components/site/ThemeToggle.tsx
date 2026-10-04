import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setThemePreference, themePreference } from "@/lib/device";

/** Light/dark toggle for the vintage palette (paper / night archive). */
export function ThemeToggle() {
  /* Read the stored preference once via a lazy initializer instead of setting
     state in an effect — same first paint, no cascading render. */
  const [mode, setMode] = useState<"light" | "dark">(() => themePreference());

  const toggle = () => {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    setThemePreference(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
      className="relative size-9 rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
    >
      {mode === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}
