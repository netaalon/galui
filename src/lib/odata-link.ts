/**
 * Links to the upstream record behind a page, so a reader can check us.
 *
 * The obvious OData form for one row is `KNS_Bill(2206637)`, and v2 served it
 * for every entity set. v4 mostly does not: of the sets this site links to,
 * only `KNS_Bill` and `KNS_PlenumSession` answer it — `KNS_Committee(4190)`
 * 404s even though the row is right there under `$filter`. So build every link
 * the filter way, which works uniformly.
 */
export const ODATA_SERVICE = "https://knesset.gov.il/OdataV4/ParliamentInfo";

export function sourceRecordUrl(entity: string, id: number): string {
  return `${ODATA_SERVICE}/${entity}?$filter=Id eq ${id}`;
}
