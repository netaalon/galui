"use client";

import { FileText, Gavel, Landmark, LayoutDashboard, MessageCircleQuestion, Speech, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { NavSearch } from "@/components/nav-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "ראשי", icon: LayoutDashboard },
  { href: "/bills", label: "הצעות חוק", icon: FileText },
  { href: "/plenum", label: "מליאה", icon: Speech },
  { href: "/committees", label: "ועדות", icon: Gavel },
  { href: "/questions", label: "שאילתות", icon: MessageCircleQuestion },
  { href: "/members", label: "חברי כנסת", icon: Users },
] as const;

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <Landmark className="size-5 text-primary" />
          <span className="text-lg tracking-tight">גלוי</span>
        </Link>

        <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="ניווט ראשי">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors lg:px-2.5",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="hidden lg:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <div className="hidden md:block">
            <Suspense fallback={null}>
              <NavSearch />
            </Suspense>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
