-- The bar a vote had to clear.
--
-- A motion of no confidence carries only by a majority of all 120 Knesset
-- members (Basic Law: The Government §28), not a majority of those who voted.
-- The coalition's answer to such a motion is usually not to vote at all, so
-- the tallies read 49 for and 0 against — and scoring that as "more for than
-- against" showed 158 of the term's 220 no-confidence votes as passed. Not one
-- of them reached 61; the best was 53.
--
-- Null means the ordinary rule. No foreign key, so a plain ADD COLUMN does it.

ALTER TABLE "PlenumVote" ADD COLUMN "majorityRequired" INTEGER;
