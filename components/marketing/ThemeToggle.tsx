"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
const subscribe = () => () => {};
/**
 * Light / dark for public pages and sites: a small pill with a knob that slides between a sun
 * and a moon. Shares the saved theme and follows the device at first.
 */
export function ThemeToggle() {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const { resolvedTheme, setTheme } = useTheme();
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={dark} onClick={() => setTheme(dark ? "light" : "dark")} className="theme-switch" data-dark={dark || undefined}>
      <Sun className="theme-switch-icon theme-switch-sun" aria-hidden />
      <Moon className="theme-switch-icon theme-switch-moon" aria-hidden />
      <span className="theme-switch-knob" aria-hidden />
    </button>
  );
}
