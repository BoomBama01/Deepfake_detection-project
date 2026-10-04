import { ScanSearch, Menu, LogOut, LayoutDashboard, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  to: string;
  label: string;
}

const LANDING_ITEMS: NavItem[] = [
  { to: "/#features", label: "Features" },
  { to: "/#how", label: "How it works" },
  { to: "/#samples", label: "Samples" },
  { to: "/#pricing", label: "Pricing" },
  { to: "/#faq", label: "FAQ" },
  { to: "/docs", label: "API" },
];

const APP_ITEMS: NavItem[] = [
  { to: "/analyze", label: "Analyze" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/learn", label: "Learn" },
  { to: "/docs", label: "API" },
];

export function Navbar({ variant = "landing" }: { variant?: "landing" | "app" }) {
  const items = variant === "app" ? APP_ITEMS : LANDING_ITEMS;
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 glass-vintage">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          to="/"
          className="group flex items-center gap-2.5"
          aria-label="TruthLens home"
        >
          <span className="flex size-9 items-center justify-center rounded-md border-2 border-primary/70 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
            <ScanSearch className="size-5" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-xl font-semibold tracking-tight">
              TruthLens
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              media forensics
            </span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-2 font-body text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {!isLoading && !isAuthenticated && (
            <>
              <Button
                asChild
                variant="ghost"
                className="hidden font-body text-sm text-muted-foreground sm:inline-flex"
              >
                <Link to="/auth">Log in</Link>
              </Button>
              <Button
                asChild
                className="hidden bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 sm:inline-flex"
              >
                <Link to="/auth">Sign up</Link>
              </Button>
            </>
          )}
          {isAuthenticated && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 font-body text-sm">
                  <UserRound className="size-4" />
                  <span className="hidden max-w-28 truncate sm:inline">
                    {user?.name || user?.email || "Account"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="font-mono text-xs text-muted-foreground">
                  {user?.email || "Signed in"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to="/dashboard">
                    <LayoutDashboard className="mr-2 size-4" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to="/dashboard?tab=account">
                    <UserRound className="mr-2 size-4" />
                    Account &amp; API keys
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => void signOut()}
                >
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* mobile menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 border border-border/70 lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="font-display text-lg">Menu</SheetTitle>
              <nav className="mt-6 flex flex-col gap-1" aria-label="Mobile">
                {items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-md px-3 py-2.5 font-body text-base text-foreground hover:bg-secondary"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  to="/analyze"
                  className="mt-2 rounded-md bg-primary px-3 py-2.5 text-center font-body text-base text-primary-foreground"
                >
                  Run a scan
                </Link>
                {!isAuthenticated && (
                  <Link
                    to="/auth"
                    className="rounded-md px-3 py-2.5 font-body text-base text-muted-foreground hover:bg-secondary"
                  >
                    Log in / Sign up
                  </Link>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
