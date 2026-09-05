/**
 * Shared between the members page (server) and its sort control (client).
 * Kept out of queries.ts deliberately: that module is `server-only` and pulls
 * in Prisma, which a client component must not bundle.
 */

export const MEMBER_SORTS = ["name", "faction", "bloc", "bills", "seniority"] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export const MEMBER_SORT_LABELS: Record<MemberSort, string> = {
  name: "שם",
  faction: "סיעה",
  bloc: "קואליציה / אופוזיציה",
  bills: "מספר הצעות חוק",
  seniority: "ותק בכנסת",
};

export function parseMemberSort(value: string | undefined): MemberSort {
  return (MEMBER_SORTS as readonly string[]).includes(value ?? "") ? (value as MemberSort) : "name";
}
