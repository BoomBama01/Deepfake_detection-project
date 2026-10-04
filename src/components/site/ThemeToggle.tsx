import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { setThemePreference, themePreference } from "@/lib/device";

/** Light/dark toggle for the vintage palette (paper / night archive). */
export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    setMode(themePreference());
  }, []);

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
