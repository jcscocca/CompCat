from __future__ import annotations

import csv
import json
from datetime import date
from io import StringIO
from typing import Any

from app.exports.tableau import escape_formula_cell

ANALYSIS_COLUMNS = [
    "place_id",
    "place_label",
    "layer",
    "analysis_start_date",
    "analysis_end_date",
    "radius_m",
    "offense_category",
    "offense_subcategory",
    "nibrs_group",
    "target_incident_count",
    "nearest_incident_m",
    "reference_method",
    "reference_geography_level",
    "reference_label",
    "reference_available",
    "reference_adequacy_status",
    "sampling_frame",
    "sampling_frame_version",
    "reference_computation",
    "reference_geography_components",
    "reference_center_count",
    "reference_draw_count",
    "reference_monte_carlo_error",
    "reference_covered_area_share",
    "reference_effective_geographies",
    "reference_p10",
    "reference_p25",
    "reference_median",
    "reference_p75",
    "reference_p90",
    "reference_share_below",
    "reference_share_equal",
    "reference_share_above",
    "reference_midrank_percentile",
    "reference_warnings",
]


def _component_json(reference: dict[str, Any]) -> str:
    components = reference.get("geography_components")
    return json.dumps(components, separators=(",", ":"), sort_keys=True) if components else ""


def build_analysis_csv(
    analysis: dict[str, Any],
    *,
    analysis_start_date: date | str,
    analysis_end_date: date | str,
    layer: str,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> str:
    """Flatten the analytical detail view into one row per place/reference-geography pair.

    The public detail view reports the fixed observed count and empirical equal-radius
    reference distributions. Legacy visit/dwell fields and polygon-density inferential fields
    are deliberately absent because the UI no longer uses either for local context.
    """

    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=ANALYSIS_COLUMNS)
    writer.writeheader()

    for place in analysis.get("places") or []:
        radius_m = place.get("radius_m", analysis.get("radius_m"))
        references = place.get("reference_comparisons") or [None]
        for reference in references:
            ref = reference if isinstance(reference, dict) else {}
            row = {
                "place_id": place.get("place_id", ""),
                "place_label": place.get("place_label", ""),
                "layer": layer,
                # These dates belong to the immutable saved run. Keep them explicit inputs
                # instead of trusting the recomputed detail payload to repeat both fields.
                "analysis_start_date": analysis_start_date,
                "analysis_end_date": analysis_end_date,
                "radius_m": radius_m,
                "offense_category": analysis.get("offense_category") or "",
                "offense_subcategory": offense_subcategory or "",
                "nibrs_group": nibrs_group or "",
                "target_incident_count": place.get("place_incident_count", ""),
                "nearest_incident_m": place.get("nearest_incident_m"),
                "reference_method": "empirical_reference_circles" if reference else "",
                "reference_geography_level": ref.get("kind", ""),
                "reference_label": ref.get("label", ""),
                "reference_available": ref.get("available", ""),
                "reference_adequacy_status": ref.get("adequacy_status", ""),
                "sampling_frame": ref.get("sampling_frame", ""),
                "sampling_frame_version": ref.get("sampling_frame_version", ""),
                "reference_computation": ref.get("computation", ""),
                "reference_geography_components": _component_json(ref),
                "reference_center_count": ref.get("reference_center_count", ""),
                "reference_draw_count": ref.get("reference_draw_count", ""),
                "reference_monte_carlo_error": ref.get("monte_carlo_error"),
                "reference_covered_area_share": ref.get("covered_area_share"),
                "reference_effective_geographies": ref.get("effective_geographies"),
                "reference_p10": ref.get("p10"),
                "reference_p25": ref.get("p25"),
                "reference_median": ref.get("median"),
                "reference_p75": ref.get("p75"),
                "reference_p90": ref.get("p90"),
                "reference_share_below": ref.get("share_below"),
                "reference_share_equal": ref.get("share_equal"),
                "reference_share_above": ref.get("share_above"),
                "reference_midrank_percentile": ref.get("midrank_percentile"),
                "reference_warnings": "|".join(ref.get("warnings") or []),
            }
            writer.writerow(
                {key: escape_formula_cell(value) for key, value in row.items()}
            )
    return output.getvalue()
