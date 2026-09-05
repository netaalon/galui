import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  person: { firstName?: string | null; lastName?: string | null; imageUrl?: string | null };
  className?: string;
};

/**
 * Photos come from Wikimedia Commons (see scripts/fetch-photos.ts); the Knesset
 * OData service has none. About a fifth of members have no free photo, so the
 * initials fallback is a normal state, not an error.
 */
export function MemberAvatar({ person, className }: Props) {
  return (
    <Avatar className={cn("size-10", className)}>
      {person.imageUrl ? (
        <AvatarImage
          src={person.imageUrl}
          alt={fullName(person)}
          loading="lazy"
          // Portraits are usually framed head-and-shoulders; bias the crop up
          // so faces are not cut off by the circular mask.
          className="object-cover object-top"
        />
      ) : null}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">
        {initials(person)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Attribution for a member's photo. CC BY-SA and CC BY both require credit, so
 * this must accompany the image wherever it is shown at any size.
 */
export function PhotoCredit({
  person,
  className,
}: {
  person: { imageUrl?: string | null; imageCredit?: string | null; imageLicense?: string | null; imageSourceUrl?: string | null };
  className?: string;
}) {
  if (!person.imageUrl) return null;
  const parts = [person.imageCredit, person.imageLicense].filter(Boolean).join(" · ");
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      תצלום:{" "}
      {person.imageSourceUrl ? (
        <a href={person.imageSourceUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
          {parts || "ויקישיתוף"}
        </a>
      ) : (
        parts
      )}
      {" · ויקישיתוף"}
    </p>
  );
}
