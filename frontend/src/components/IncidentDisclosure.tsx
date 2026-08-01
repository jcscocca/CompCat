import type { IncidentNoun } from "../lib/layerCopy";

type Props = {
  returnedCount: number;
  totalCount: number;
  returnedLocationCount: number;
  totalLocationCount: number;
  unmappableCitywideCount: number;
  limit: number;
  itemNoun?: IncidentNoun;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const DEFAULT_NOUN: IncidentNoun = { singular: "incident", plural: "incidents", pluralCap: "Incidents" };

export function IncidentDisclosure({
  returnedCount,
  totalCount,
  returnedLocationCount,
  totalLocationCount,
  unmappableCitywideCount,
  limit,
  itemNoun = DEFAULT_NOUN,
}: Props) {
  if (limit === 0) {
    return null; // nothing fetched yet
  }
  const truncated = totalLocationCount > returnedLocationCount;
  const locationLabel = `${fmt(totalLocationCount)} block location${totalLocationCount === 1 ? "" : "s"}`;
  return (
    <div className="mc-disclosure" role="status">
      <strong>
        {totalCount === 0
          ? `No ${itemNoun.plural} in current map view`
          : `${fmt(totalCount)} ${totalCount === 1 ? itemNoun.singular : itemNoun.plural} across ${locationLabel} in current map view`}
      </strong>
      {totalCount > 0 ? (
        <span className="mc-disclosure-detail">
          {truncated
            ? `Map represents ${fmt(returnedCount)} records at ${fmt(returnedLocationCount)} block locations with the most recent records. Records mapped to the same block stay grouped.`
            : "Records mapped to the same block are shown as counted stacks."}
        </span>
      ) : null}
      {unmappableCitywideCount > 0 ? (
        <span className="mc-disclosure-detail">+{fmt(unmappableCitywideCount)} citywide with redacted location — in beat stats only.</span>
      ) : null}
    </div>
  );
}
