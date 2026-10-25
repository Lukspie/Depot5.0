/** Theme switching: <html data-theme="sps|modra">, remembered per browser. */

export type Theme = "sps" | "modra";

export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: "sps", label: "SPS (oranžová)", swatch: "#f39200" },
  { id: "modra", label: "Modrá", swatch: "#2f5be9" },
];

const KEY = "depotrack.theme";

export function loadTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "sps" || saved === "modra") return saved;
  } catch {
    // storage blocked (private window): default theme
  }
  return "sps";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // not persisted, still applied
  }
}
