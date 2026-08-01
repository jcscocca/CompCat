type Props = {
  returnedCount: number;
  totalCount: number;
  returnedLocationCount: number;
  totalLocationCount: number;
  unmappableCitywideCount: number;
  limit: number;
  itemLabel?: string;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function IncidentDisclosure({
  returnedCount,
  totalCount,
  returnedLocationCount,
  totalLocationCount,
  unmappableCitywideCount,
  limit,
  itemLabel = "incidents",
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
          ? `No ${itemLabel} in current map view`
          : `${fmt(totalCount)} ${itemLabel} across ${locationLabel} in current map view`}
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
