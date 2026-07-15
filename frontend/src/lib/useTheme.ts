import { useCallback, useEffect, useState } from "react";

export type ThemeName = "light" | "dark";
const STORAGE_KEY = "compcat.theme";

function stored(): ThemeName | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(() => stored() ?? "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
