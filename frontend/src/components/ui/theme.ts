/** Theme switching: <html data-theme="oranzova|modra">, remembered per browser. */

export type Theme = "oranzova" | "modra";

export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: "oranzova", label: "Oranžová", swatch: "#f39200" },
  { id: "modra", label: "Modrá", swatch: "#2f5be9" },
];

const KEY = "depotrack.theme";

export function loadTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "oranzova" || saved === "modra") return saved;
  } catch {
    // storage blocked (private window): default theme
  }
  // nothing saved, or "sps" saved before the theme was renamed (ADR-044)
  return "oranzova";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // not persisted, still applied
  }
}
