import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  person: { firstName?: string | null; lastName?: string | null; imageUrl?: string | null };
  className?: string;
};

/**
 * The OData service exposes no headshot endpoint and scraping knesset.gov.il is
 * out of scope, so `imageUrl` is null for now and every member renders as
 * initials. Wire a licensed image source into the ETL and this starts showing
 * photos with no change here.
 */
export function MemberAvatar({ person, className }: Props) {
  return (
    <Avatar className={cn("size-10", className)}>
      {person.imageUrl ? <AvatarImage src={person.imageUrl} alt={fullName(person)} /> : null}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">
        {initials(person)}
      </AvatarFallback>
    </Avatar>
  );
}
