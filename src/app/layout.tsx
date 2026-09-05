import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// The entire dataset is Hebrew, so the interface is Hebrew and right-to-left.
const heebo = Heebo({
  variable: "--font-sans",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "גלוי — מעקב אחר פעילות הכנסת", template: "%s · גלוי" },
  description:
    "מעקב אחר הצעות חוק, חברי כנסת ודיוני ועדות, מבוסס על ה-API הרשמי של הכנסת.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <Navbar />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
          <footer className="border-t py-6">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 text-sm text-muted-foreground sm:px-6">
              <p>
                הנתונים נשאבים ישירות מ־
                <a
                  href="https://knesset.gov.il/Odata/ParliamentInfo.svc/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  שירות ה־OData הרשמי של הכנסת
                </a>
                .
              </p>
              <p>
                גלוי — גרסת MVP · <Link href="/bills" className="underline underline-offset-4 hover:text-foreground">הצעות חוק</Link>
                {" · "}
                <Link href="/members" className="underline underline-offset-4 hover:text-foreground">חברי כנסת</Link>
              </p>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
