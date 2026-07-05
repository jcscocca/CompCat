type Props = {
  returnedCount: number;
  totalCount: number;
  unmappableCitywideCount: number;
  limit: number;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function IncidentDisclosure({ returnedCount, totalCount, unmappableCitywideCount, limit }: Props) {
  if (limit === 0) {
    return null; // nothing fetched yet
  }
  const truncated = totalCount > returnedCount;
  return (
    <div className="mc-disclosure" role="status">
      <strong>
        {truncated
          ? `most recent ${fmt(returnedCount)} of ${fmt(totalCount)} shown`
          : `${fmt(returnedCount)} incidents shown`}
      </strong>
      {unmappableCitywideCount > 0 ? (
        <span> · +{fmt(unmappableCitywideCount)} citywide with redacted location — in beat stats only</span>
      ) : null}
    </div>
  );
}
