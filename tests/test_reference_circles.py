from __future__ import annotations

from app.analysis.reference_circles import (
    IncidentGrid,
    ReferenceCenter,
    ReferenceComponent,
    ReferenceFrame,
    build_reference_distribution,
    load_reference_frame,
    polygon_overlap_profile,
    reference_distributions_for_place,
    summarize_reference_counts,
)


def _frame(count: int, *, version: str = "test-v1") -> ReferenceFrame:
    centers = tuple(
        ReferenceCenter(
            center_id=f"c-{index}",
            latitude=47.60 + (index % 50) * 0.0001,
            longitude=-122.33 + (index // 50) * 0.0001,
            street_name=f"Street {index}",
            mcpps=("TEST",),
            sector="T",
        )
        for index in range(count)
    )
    indices = tuple(range(count))
    return ReferenceFrame(
        version=version,
        centers=centers,
        by_mcpp={"TEST": indices},
        by_sector={"T": indices},
        metadata={"frame_version": version, "center_count": count},
    )


def test_checked_in_reference_frame_is_versioned_and_geographically_indexed():
    frame = load_reference_frame()

    assert frame.version == "seattle_snd_open_public_street_midpoints_v1"
    assert len(frame.centers) == 23_793
    assert sum(bool(center.mcpps) for center in frame.centers) == 23_719
    # A small number of segments lie exactly on the published city/beat boundary.
    assert sum(center.sector is not None for center in frame.centers) == 23_720
    assert "DOWNTOWN COMMERCIAL" in frame.by_mcpp
    assert "M" in frame.by_sector


def test_downtown_sector_mixture_tolerates_a_centerless_harbor_sliver():
    from app.analysis.area_baselines import load_mcpp_polygons
    from app.analysis.beat_baselines import load_beat_polygons

    references = reference_distributions_for_place(
        frame=load_reference_frame(),
        incident_grid=IncidentGrid([]),
        latitude=47.6005,
        longitude=-122.3315,
        radius_m=1000,
        target_count=0,
        mcpp_polygons=load_mcpp_polygons(),
        beat_polygons=load_beat_polygons(),
    )
    sector = next(entry for entry in references if entry["kind"] == "sector")

    assert sector["available"] is True
    assert sector["covered_area_share"] > 0.99
    assert all(component["id"] != "H" for component in sector["geography_components"])
    assert "partial_reference_frame_coverage" in sector["warnings"]


def test_incident_grid_uses_exact_radius_after_bucket_prefilter():
    grid = IncidentGrid(
        [
            (47.6000, -122.3300),
            (47.6005, -122.3300),
            (47.6100, -122.3300),
        ]
    )

    assert grid.count_within(47.6000, -122.3300, 100) == 2
    assert grid.count_within(47.6000, -122.3300, 25) == 1


def test_reference_summary_handles_ties_without_hiding_them_in_a_percentile():
    summary = summarize_reference_counts(
        [(4, 0.25), (8, 0.25), (8, 0.25), (15, 0.25)],
        target_count=8,
    )

    assert summary == {
        "p10": 4,
        "p25": 4,
        "median": 8,
        "p75": 8,
        "p90": 15,
        "share_below": 0.25,
        "share_equal": 0.5,
        "share_above": 0.25,
        "midrank_percentile": 0.5,
    }


def test_exact_distribution_preserves_component_weights():
    frame = _frame(120)
    components = [
        ReferenceComponent(
            component_id="A",
            label="A",
            weight=0.75,
            center_indices=tuple(range(90)),
        ),
        ReferenceComponent(
            component_id="B",
            label="B",
            weight=0.25,
            center_indices=tuple(range(90, 120)),
        ),
    ]
    result = build_reference_distribution(
        kind="mcpp",
        label="MCPP context",
        frame=frame,
        components=components,
        incident_grid=IncidentGrid([]),
        target_count=0,
        latitude=47.60,
        longitude=-122.33,
        radius_m=250,
        covered_area_share=1.0,
    )

    assert result["available"] is True
    assert result["computation"] == "exact"
    assert result["reference_center_count"] == 120
    assert result["reference_draw_count"] == 120
    assert result["share_equal"] == 1.0
    assert [row["weight"] for row in result["geography_components"]] == [0.75, 0.25]


def test_tiny_centerless_boundary_component_reduces_coverage_without_losing_rung():
    frame = _frame(120)
    result = build_reference_distribution(
        kind="sector",
        label="Sector context",
        frame=frame,
        components=[
            ReferenceComponent(
                component_id="T",
                label="Sector T",
                weight=0.99,
                center_indices=tuple(range(120)),
            ),
            ReferenceComponent(
                component_id="H",
                label="Sector H",
                weight=0.01,
                center_indices=(),
            ),
        ],
        incident_grid=IncidentGrid([]),
        target_count=0,
        latitude=47.60,
        longitude=-122.33,
        radius_m=250,
        covered_area_share=1.0,
    )

    assert result["available"] is True
    assert result["covered_area_share"] == 0.99
    assert result["geography_components"] == [
        {
            "id": "T",
            "label": "Sector T",
            "weight": 1.0,
            "center_count": 120,
        }
    ]
    assert "partial_reference_frame_coverage" in result["warnings"]


def test_large_frame_uses_reproducible_monte_carlo_draws():
    frame = _frame(3_000)
    component = ReferenceComponent(
        component_id="SEATTLE",
        label="Seattle",
        weight=1.0,
        center_indices=tuple(range(3_000)),
    )
    kwargs = {
        "kind": "city",
        "label": "Citywide",
        "frame": frame,
        "components": [component],
        "incident_grid": IncidentGrid([(47.60, -122.33)]),
        "target_count": 1,
        "latitude": 47.60,
        "longitude": -122.33,
        "radius_m": 250,
        "covered_area_share": 1.0,
    }

    first = build_reference_distribution(**kwargs)
    second = build_reference_distribution(**kwargs)

    assert first == second
    assert first["computation"] == "monte_carlo"
    assert first["reference_draw_count"] == 2_500
    assert 0 < first["monte_carlo_error"] < 0.02


def test_polygon_profile_separates_membership_weights_from_union_coverage():
    # Two overlapping polygons collectively cover the full test circle. Their component
    # memberships overlap near the center, but union coverage cannot exceed 100%.
    west = [
        [
            (-122.332, 47.598),
            (-122.3298, 47.598),
            (-122.3298, 47.602),
            (-122.332, 47.602),
            (-122.332, 47.598),
        ]
    ]
    east = [
        [
            (-122.3302, 47.598),
            (-122.328, 47.598),
            (-122.328, 47.602),
            (-122.3302, 47.602),
            (-122.3302, 47.598),
        ]
    ]

    overlaps, coverage = polygon_overlap_profile(
        longitude=-122.33,
        latitude=47.60,
        radius_m=100,
        polygons={"WEST": [west], "EAST": [east]},
    )

    assert set(overlaps) == {"WEST", "EAST"}
    assert sum(overlaps.values()) > 3.14159 * 100 * 100 / 1_000_000
    assert coverage == 1.0


def test_inadequate_reference_frame_refuses_comparative_statistics():
    frame = _frame(10)
    result = build_reference_distribution(
        kind="sector",
        label="Sector T",
        frame=frame,
        components=[
            ReferenceComponent(
                component_id="T",
                label="Sector T",
                weight=1.0,
                center_indices=tuple(range(10)),
            )
        ],
        incident_grid=IncidentGrid([]),
        target_count=0,
        latitude=47.60,
        longitude=-122.33,
        radius_m=250,
        covered_area_share=1.0,
    )

    assert result["available"] is False
    assert result["adequacy_status"] == "insufficient_reference_centers"
    assert result["median"] is None
    assert result["share_equal"] is None
