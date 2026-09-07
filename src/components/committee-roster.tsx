import Link from "next/link";
import { BlocBadge } from "@/components/bloc-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { Badge } from "@/components/ui/badge";
import { formatDate, fullName } from "@/lib/format";
import type { RosterSeat } from "@/lib/queries";

/**
 * A committee's appointed composition.
 *
 * Kept visually distinct from the attendance list beside it, because they answer
 * different questions and their sizes differ by a factor of three: Finance
 * appoints 20 members, while 67 people have sat in its sittings.
 */
export function CommitteeRoster({
  chairs,
  members,
  substitutes,
  memberCount,
  past,
  blocs,
}: {
  chairs: RosterSeat[];
  members: RosterSeat[];
  substitutes: RosterSeat[];
  memberCount: number;
  past: RosterSeat[];
  blocs: Map<string, number>;
}) {
  const coalition = blocs.get("coalition") ?? 0;
  const opposition = blocs.get("opposition") ?? 0;

  return (
    <div className="space-y-5">
      {/* The chair is one of the members, so the total is stated here and the
          groups below list each person once. */}
      <p className="text-xs text-muted-foreground">
        {memberCount.toLocaleString("he-IL")} חברים, ובהם היו״ר
        {coalition > 0 ? ` · ${coalition.toLocaleString("he-IL")} מהקואליציה` : ""}
        {opposition > 0 ? ` · ${opposition.toLocaleString("he-IL")} מהאופוזיציה` : ""}
      </p>

      {chairs.length > 0 ? <Group label="יושב/ת ראש" seats={chairs} prominent /> : null}
      {members.length > 0 ? <Group label={`חברים נוספים (${members.length})`} seats={members} /> : null}
      {substitutes.length > 0 ? (
        <Group label={`מ"מ (${substitutes.length})`} seats={substitutes} muted />
      ) : null}
      {past.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            כיהנו בעבר ({past.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {past.map((s) => (
              <li key={s.personToPositionId} className="text-xs text-muted-foreground">
                <Link href={`/members/${s.person.personId}`} className="hover:text-foreground hover:underline">
                  {fullName(s.person)}
                </Link>
                {s.role === "chair" ? <span> · יו״ר</span> : null}
                {s.finishDate ? <span> · עד {formatDate(s.finishDate)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Group({
  label,
  seats,
  prominent = false,
  muted = false,
}: {
  label: string;
  seats: RosterSeat[];
  prominent?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className={muted ? "space-y-1" : "space-y-2"}>
        {seats.map((s) => (
          <li key={s.personToPositionId}>
            <Link
              href={`/members/${s.person.personId}`}
              className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-secondary/60"
            >
              {muted ? null : <MemberAvatar person={s.person} className={prominent ? "size-9" : "size-7"} />}
              <span className="min-w-0 flex-1">
                <span className={prominent ? "block truncate text-sm font-medium" : "block truncate text-sm"}>
                  {fullName(s.person)}
                </span>
                {s.person.factionName && !muted ? (
                  <span className="block truncate text-xs text-muted-foreground">{s.person.factionName}</span>
                ) : null}
              </span>
              {s.person.bloc ? <BlocBadge bloc={s.person.bloc} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The committee seats one member holds, for their own page. */
export function MemberSeats({
  seats,
}: {
  seats: Array<{
    personToPositionId: number;
    committeeId: number | null;
    committeeName: string | null;
    role: "chair" | "member" | "substitute";
    isCurrent: boolean;
    finishDate: Date | null;
  }>;
}) {
  const ROLE_LABEL = { chair: "יו״ר", member: "חבר/ה", substitute: 'מ"מ' } as const;

  return (
    <ul className="space-y-2">
      {seats.map((s) => (
        <li key={s.personToPositionId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          {s.committeeId ? (
            <Link href={`/committees/${s.committeeId}`} className="min-w-0 flex-1 hover:underline">
              {s.committeeName ?? "ועדה"}
            </Link>
          ) : (
            <span className="min-w-0 flex-1">{s.committeeName ?? "ועדה"}</span>
          )}
          <Badge variant={s.role === "chair" ? "default" : "outline"} className="text-[0.6875rem] font-normal">
            {ROLE_LABEL[s.role]}
          </Badge>
          {!s.isCurrent ? (
            <span className="text-xs text-muted-foreground">
              {s.finishDate ? `עד ${formatDate(s.finishDate)}` : "בעבר"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
