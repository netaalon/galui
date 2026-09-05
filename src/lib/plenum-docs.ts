/**
 * A plenum sitting can carry hundreds of documents, the vast majority of them
 * per-item queue files ("תור מליאה"). Split the handful worth showing from the
 * long tail so a sitting page stays readable.
 */
const PRIMARY = ["דברי הכנסת", "סטנוגרמה", "תוכן עניינים"];

export type PlenumDocLike = {
  id: string;
  groupTypeDesc: string | null;
  applicationDesc: string | null;
  filePath: string | null;
};

export function splitPlenumDocs<T extends PlenumDocLike>(docs: T[]): { primary: T[]; rest: T[] } {
  const withFile = docs.filter((d) => d.filePath);
  const primary = withFile.filter((d) => PRIMARY.some((p) => (d.groupTypeDesc ?? "").trim().startsWith(p)));
  const rest = withFile.filter((d) => !primary.includes(d));
  return { primary, rest };
}
