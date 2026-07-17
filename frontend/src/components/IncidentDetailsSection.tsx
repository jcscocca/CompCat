import type { IncidentDetail, IncidentDetailsResponse } from "../types";
import { formatIncidentAddress, titleCase } from "../lib/addressLabel";
import { countNoun, type IncidentNoun } from "../lib/layerCopy";

function incidentCategoryLabel(incident: IncidentDetail) {
  return incident.offense_category ? titleCase(incident.offense_category) : "Uncategorized";
}

function incidentSubtypeLabel(incident: IncidentDetail) {
  if (incident.offense_subcategory) return titleCase(incident.offense_subcategory);
  return incident.nibrs_group ? `NIBRS ${incident.nibrs_group}` : "All reported";
}

function incidentIdentifier(incident: IncidentDetail) {
  return incident.report_number || incident.external_incident_id || incident.incident_id;
}

function formatIncidentTime(value: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const date = [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(parsed.getUTCHours()).padStart(2, "0"),
    String(parsed.getUTCMinutes()).padStart(2, "0"),
  ].join(":");
  // The SPD `offense_start_utc` field actually holds Seattle local wall-clock time (a known
  // column misnomer), and the getUTC* reads above pull those exact digits back out. Label it
  // "Seattle time" — calling it UTC misstated every incident time by 7-8 hours.
  return `${date} ${time} Seattle time`;
}

function formatDistanceMeters(value: number) {
  return `${Math.round(value)} m`;
}

function IncidentDetailsTable({ details, noun, showCategory, subcategoryHeader }: { details: IncidentDetailsResponse | null | undefined; noun: IncidentNoun; showCategory: boolean; subcategoryHeader: string }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching ${noun.plural}.`
    : `${details.total_count} matching ${countNoun(noun, details.total_count)}.`;

  return (
    <section className="mc-incident-details" aria-label={`${noun.pluralCap} near selected places`}>
      <div className="mc-breakdown-head">
        <h5>{noun.pluralCap} near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching {noun.plural} for the selected filters.</p>
      ) : (
        <>
          <p className="mc-incident-count">{countText}</p>
          <div className="mc-incident-table-wrap">
            <table className="mc-incident-table">
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">Date/time</th>
                  {/* 911 calls carry no offense category — arrests carry a crosswalked one. */}
                  {showCategory ? <th scope="col">Category</th> : null}
                  <th scope="col">{subcategoryHeader}</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Block/address</th>
                  <th scope="col">ID</th>
                </tr>
              </thead>
              <tbody>
                {details.incidents.map((incident) => (
                  <tr key={`${incident.place_id}-${incident.incident_id}`}>
                    <td>{incident.place_label}</td>
                    <td>{formatIncidentTime(incident.occurred_at || incident.reported_at)}</td>
                    {showCategory ? <td>{incidentCategoryLabel(incident)}</td> : null}
                    <td>{incidentSubtypeLabel(incident)}</td>
                    <td>{formatDistanceMeters(incident.distance_m)}</td>
                    <td>{formatIncidentAddress(incident.block_address)}</td>
                    <td>{incidentIdentifier(incident)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function IncidentDetailsCards({ details, noun, showCategory }: { details: IncidentDetailsResponse | null | undefined; noun: IncidentNoun; showCategory: boolean; subcategoryHeader: string }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching ${noun.plural}.`
    : `${details.total_count} matching ${countNoun(noun, details.total_count)}.`;

  return (
    <section className="mc-incident-details" aria-label={`${noun.pluralCap} near selected places`}>
      <div className="mc-breakdown-head">
        <h5>{noun.pluralCap} near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching {noun.plural} for the selected filters.</p>
      ) : (
        <>
          <p className="mc-incident-count">{countText}</p>
          <div className="mc-incident-cards">
            {details.incidents.map((incident) => (
              <article className="mc-icard" key={`${incident.place_id}-${incident.incident_id}`}>
                <div className="mc-icard-top">
                  <strong>{incident.place_label}</strong>
                  <em>{formatDistanceMeters(incident.distance_m)}</em>
                </div>
                <div className="mc-icard-tags">
                  {showCategory ? <span>{incidentCategoryLabel(incident)}</span> : null}
                  <span>{incidentSubtypeLabel(incident)}</span>
                  <span>{formatIncidentTime(incident.occurred_at || incident.reported_at)}</span>
                </div>
                <p className="mc-icard-addr"><span>{formatIncidentAddress(incident.block_address)}</span> · <span>{incidentIdentifier(incident)}</span></p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function IncidentDetailsSection({ details, noun, layout, showCategory, subcategoryHeader }: {
  details: IncidentDetailsResponse | null | undefined;
  noun: IncidentNoun;
  layout: "table" | "cards";
  showCategory: boolean;
  subcategoryHeader: string;
}) {
  if (!details) return null;
  const body = layout === "table" ? (
    <IncidentDetailsTable details={details} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
  ) : (
    <IncidentDetailsCards details={details} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
  );
  if (details.incidents.length > 0) {
    return (
      <details className="mc-incident-reveal">
        <summary>See the {details.total_count} {countNoun(noun, details.total_count)}</summary>
        {body}
      </details>
    );
  }
  return body;
}
