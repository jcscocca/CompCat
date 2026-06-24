from __future__ import annotations


def supported_input_modes(include_personal_uploads: bool = False) -> list[dict[str, object]]:
    modes: list[dict[str, object]] = [
        {
            "id": "manual_places",
            "label": "Enter places manually",
            "privacy_level": "low",
            "description": "Type approximate places, visit frequency, and optional dwell time.",
            "required_columns": [],
            "optional_columns": [],
            "sample_csv": "",
        },
        {
            "id": "bulk_places",
            "label": "Paste a place list",
            "privacy_level": "low",
            "description": "Paste rows with display_label, latitude, longitude, and visit_count.",
            "required_columns": ["display_label", "latitude", "longitude"],
            "optional_columns": [
                "visit_count",
                "total_dwell_minutes",
                "median_dwell_minutes",
                "typical_days",
                "typical_hours",
                "sensitivity_class",
            ],
            "sample_csv": (
                "display_label,latitude,longitude,visit_count,total_dwell_minutes\n"
                "Downtown transfer stop,47.609,-122.333,12,360\n"
            ),
        },
        {
            "id": "public_commute_scenario",
            "label": "Public commute scenario",
            "privacy_level": "very_low",
            "description": "Model a commute using generalized Seattle areas.",
            "required_columns": ["origin_area", "destination_area", "mode"],
            "optional_columns": ["usual_departure_time", "frequency_per_week"],
            "sample_csv": (
                "origin_area,destination_area,mode,usual_departure_time,frequency_per_week\n"
                "Capitol Hill,Downtown Seattle,transit,08:00,4\n"
            ),
        },
    ]
    if include_personal_uploads:
        modes.append(
            {
                "id": "personal_timeline",
                "label": "Personal timeline upload",
                "privacy_level": "high",
                "description": "Google Timeline JSON, raw point CSV, GeoJSON, or GPX.",
                "required_columns": [],
                "optional_columns": [],
                "sample_csv": "",
            }
        )
    return modes
