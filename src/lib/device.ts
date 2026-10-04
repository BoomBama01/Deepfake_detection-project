/** Stable per-browser id for guest quotas (localStorage only, no cookies). */
export function getDeviceId(): string {
  const KEY = "truthlens-device-id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id || id.length < 8) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // storage blocked — session-only fallback
    let id = sessionStorage.getItem(KEY);
    if (!id || id.length < 8) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  }
}

export function themePreference(): "light" | "dark" {
  try {
    const t = localStorage.getItem("truthlens-theme");
    if (t === "dark" || t === "light") return t;
  } catch {
    /* ignore */
  }
  return "light";
}

export function setThemePreference(mode: "light" | "dark"): void {
  try {
    localStorage.setItem("truthlens-theme", mode);
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.classList.toggle("light", mode !== "dark");
}
