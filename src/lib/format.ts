/**
 * Display helpers.
 *
 * The ETL stores every OData DateTime as UTC standing in for the Israeli
 * wall-clock time the Knesset published (the service emits no zone offset).
 * Every formatter here therefore renders in UTC, so a session listed as
 * 10:00 upstream reads as 10:00 here regardless of the viewer's timezone.
 */

const TZ = "UTC";
const LOCALE = "he-IL";

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric", month: "long", year: "numeric", timeZone: TZ,
});
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
});
const monthFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "short", year: "2-digit", timeZone: TZ,
});

export function formatDate(d: Date | null | undefined): string {
  return d ? dateFmt.format(d) : "—";
}

export function formatShortDate(d: Date | null | undefined): string {
  return d ? shortDateFmt.format(d) : "—";
}

export function formatTime(d: Date | null | undefined): string {
  return d ? timeFmt.format(d) : "";
}

export function formatDateTime(d: Date | null | undefined): string {
  return d ? `${shortDateFmt.format(d)} · ${timeFmt.format(d)}` : "—";
}

/** "אוג׳ 25" — axis label for the activity chart. */
export function formatMonth(d: Date): string {
  return monthFmt.format(d);
}

/** "לפני 3 ימים" / "בעוד יומיים" — relative to now, in Hebrew. */
const relFmt = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
export function formatRelative(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const diffMs = d.getTime() - now.getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) < 1) {
    const hours = Math.round(diffMs / 3_600_000);
    return relFmt.format(hours, "hour");
  }
  if (Math.abs(days) < 31) return relFmt.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return relFmt.format(months, "month");
  return relFmt.format(Math.round(days / 365), "year");
}

export function fullName(p: { firstName?: string | null; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || "ללא שם";
}

/** Two-letter initials for the avatar fallback. */
export function initials(p: { firstName?: string | null; lastName?: string | null }): string {
  const a = p.firstName?.trim()?.[0] ?? "";
  const b = p.lastName?.trim()?.[0] ?? "";
  return (a + b) || "?";
}

export function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** knesset.gov.il member page for an MK, when we know their site code. */
export function knessetMemberUrl(mkSiteCode: string | null | undefined): string | null {
  return mkSiteCode ? `https://main.knesset.gov.il/mk/Pages/MkPersonalDetails.aspx?MkPersonalDetailsID=${mkSiteCode}` : null;
}

/**
 * Hebrew count phrasing: one item reads "סעיף אחד", not "1 סעיפים".
 * Only the singular case is special-cased — dual forms ("שני סעיפים") are
 * optional in modern usage and the numeric form stays readable.
 */
export function countLabel(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : `${n.toLocaleString("he-IL")} ${plural}`;
}
