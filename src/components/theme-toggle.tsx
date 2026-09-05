"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Which icon shows is decided in CSS off the `dark` class that next-themes puts
 * on <html>, so the server and client render identical markup and no mounted
 * flag is needed. The hook is used only to write the theme on click.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="החלפה בין מצב בהיר לכהה"
      title="החלפה בין מצב בהיר לכהה"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Moon className="size-4.5 dark:hidden" />
      <Sun className="hidden size-4.5 dark:block" />
    </Button>
  );
}
