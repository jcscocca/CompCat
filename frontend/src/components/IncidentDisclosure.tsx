type Props = {
  returnedCount: number;
  totalCount: number;
  unmappableCitywideCount: number;
  limit: number;
  itemLabel?: string;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function IncidentDisclosure({
  returnedCount,
  totalCount,
  unmappableCitywideCount,
  limit,
  itemLabel = "incidents",
}: Props) {
  if (limit === 0) {
    return null; // nothing fetched yet
  }
  const truncated = totalCount > returnedCount;
  return (
    <div className="mc-disclosure" role="status">
      <strong>
        {truncated
          ? `most recent ${fmt(returnedCount)} of ${fmt(totalCount)} ${itemLabel} in current map view`
          : `${fmt(returnedCount)} ${itemLabel} in current map view`}
      </strong>
      {unmappableCitywideCount > 0 ? (
        <span> · +{fmt(unmappableCitywideCount)} citywide with redacted location — in beat stats only</span>
      ) : null}
    </div>
  );
}
