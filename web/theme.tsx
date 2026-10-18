import { useState } from "react";
import { flushSync } from "react-dom";
import { Contrast } from "lucide-react";

type Theme = "light" | "dark";
const key = "gestion-theme";
let initial: Theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
try {
  const saved = localStorage.getItem(key);
  if (saved === "light" || saved === "dark") initial = saved;
} catch { /* The theme still works when storage is unavailable. */ }
function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#191919" : "#f5f5f5");
}
apply(initial);

export function ThemeToggle() {
  const [theme, setTheme] = useState(initial);
  const [changing, setChanging] = useState(false);
  const next = theme === "dark" ? "light" : "dark";
  async function toggle() {
    if (changing) return;
    const update = () => {
      apply(next);
      setTheme(next);
      try { localStorage.setItem(key, next); } catch { /* Optional persistence. */ }
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    flushSync(() => setChanging(true));
    if (!document.startViewTransition) {
      document.documentElement.classList.add("theme-changing");
      // Establish the old colors before enabling the CSS transition fallback.
      void document.documentElement.offsetWidth;
      update();
      await new Promise(resolve => setTimeout(resolve, 600));
      document.documentElement.classList.remove("theme-changing");
      setChanging(false);
      return;
    }
    const transition = document.startViewTransition(() => flushSync(update));
    try {
      await transition.ready;
      document.documentElement.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 550, easing: "ease-in-out", fill: "both", pseudoElement: "::view-transition-new(root)" },
      );
      await transition.finished;
    } catch {
      // A skipped transition must never prevent changing the theme.
      transition.skipTransition();
    } finally {
      setChanging(false);
    }
  }
  return <>
    <button type="button" className="icon-btn theme-toggle" onClick={toggle} disabled={changing}
      aria-label={`Cambiar a modo ${next === "dark" ? "oscuro" : "claro"}`} title={`Modo ${next === "dark" ? "oscuro" : "claro"}`}>
      <Contrast size={21} />
    </button>
  </>;
}
