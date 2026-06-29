# Agent-Driven Pane Analysis (PoC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the chat assistant resolve places named in chat, run analysis, and drive the dashboard right pane (fill the Compare/Analyze tabs and switch to them) — automatically and transparently.

**Architecture:** Backend-tool-driven. The existing agent loop gains a 6-tool toolbox of self-contained per-tab workflow tools that resolve place names internally (match a saved place, else geocode + create) and return a payload shaped for the pane. The frontend's `AssistantPanel` stops discarding tool results and forwards them to one coordinated `applyAssistantToolResult` action in `MapWorkspace` that sets selection, syncs analysis settings, refetches the dashboard summary, drops in the result, and switches tabs.

**Tech Stack:** Python / FastAPI / SQLAlchemy / Pydantic (backend, pytest); React + TypeScript + Vite (frontend, vitest + Testing Library). Geocoding via the existing `app/geocoding` Nominatim provider. Place creation via `app/services/manual_place_service.create_manual_place`.

**Design reference:** `docs/superpowers/specs/2026-06-28-agent-driven-pane-analysis-design.md`.

**Working location:** This plan runs in the worktree `.worktrees/agent-pane-analysis` (branch `jcscocca/claude/agent-pane-analysis`). Run backend tests from the worktree root with `PYTHONPATH` pointing at the worktree so the worktree's `app/` wins over any editable-installed `app/` in the shared `.venv`:

```bash
cd /Users/jscocca/Repos/Crime\ Commute\ Safety\ Tool/.worktrees/agent-pane-analysis
PYTHONPATH=. .venv/bin/pytest tests/test_place_resolution.py -v
```

Frontend tests: `cd frontend && npm test`.

---

## Part A — Backend: resolver + toolbox

Part A is independently shippable and testable (pytest + a live API). Part B consumes the tool-result shapes defined here.

### Task A1: Shared place resolver

Resolve free-text place names to place ids — match an existing saved place, else geocode the top hit and create a manual place. The created place's label is the user's query; the geocoder's full label is kept as `address` for transparent narration.

**Files:**
- Create: `app/assistant/place_resolution.py`
- Test: `tests/test_place_resolution.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_place_resolution.py
from __future__ import annotations

from app.assistant.place_resolution import resolve_place_queries
from app.db import get_sessionmaker
from app.geocoding.providers import GeocodeHit, GeocoderUpstreamError
from app.main import create_app
from app.models import PlaceCluster


class FakeProvider:
    def __init__(self, hits=None, error=False):
        self._hits = hits or []
        self._error = error

    def search(self, query):
        if self._error:
            raise GeocoderUpstreamError("upstream down")
        return self._hits


def _session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="home-1",
            user_id_hash="user-1",
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.61,
            centroid_longitude=-122.33,
            display_latitude=47.61,
            display_longitude=-122.33,
            visit_count=1,
            sensitivity_class="normal",
            display_label="Home",
            inferred_place_type="manual_place",
            label_source="manual",
        )
    )
    session.commit()
    return session


def test_resolver_matches_existing_place_case_insensitively(tmp_path):
    session = _session(tmp_path)
    provider = FakeProvider()
    try:
        resolved = resolve_place_queries(session, "user-1", ["  home "], provider)
    finally:
        session.close()
    assert resolved.place_ids == ["home-1"]
    assert resolved.matched[0]["place_id"] == "home-1"
    assert resolved.created == []
    assert resolved.unresolved == []


def test_resolver_geocodes_and_creates_missing_place(tmp_path):
    session = _session(tmp_path)
    provider = FakeProvider(
        hits=[GeocodeHit(label="Pike Place Market, Seattle, WA", latitude=47.6097, longitude=-122.3422, source="nominatim")]
    )
    try:
        resolved = resolve_place_queries(session, "user-1", ["Pike Place Market"], provider)
        created_id = resolved.created[0]["place_id"]
        place = session.get(PlaceCluster, created_id)
    finally:
        session.close()
    assert resolved.place_ids == [created_id]
    assert resolved.created[0]["label"] == "Pike Place Market"
    assert resolved.created[0]["address"] == "Pike Place Market, Seattle, WA"
    assert place is not None
    assert place.display_label == "Pike Place Market"
    assert place.inferred_place_type == "manual_place"


def test_resolver_reports_unresolved_on_geocoder_failure(tmp_path):
    session = _session(tmp_path)
    try:
        resolved = resolve_place_queries(session, "user-1", ["Nowhere"], FakeProvider(error=True))
    finally:
        session.close()
    assert resolved.place_ids == []
    assert resolved.unresolved == ["Nowhere"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_place_resolution.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.assistant.place_resolution'`

- [ ] **Step 3: Write the resolver**

```python
# app/assistant/place_resolution.py
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geocoding.providers import GeocodeProvider, GeocoderUpstreamError
from app.models import PlaceCluster
from app.places.schemas import ManualPlaceCreate
from app.services.manual_place_service import create_manual_place


@dataclass(frozen=True)
class ResolvedPlaces:
    place_ids: list[str] = field(default_factory=list)
    matched: list[dict[str, Any]] = field(default_factory=list)
    created: list[dict[str, Any]] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)


def _normalize(label: str) -> str:
    return " ".join(label.strip().lower().split())


def _existing_by_label(session: Session, user_id_hash: str) -> dict[str, PlaceCluster]:
    rows = session.scalars(
        select(PlaceCluster).where(PlaceCluster.user_id_hash == user_id_hash)
    )
    index: dict[str, PlaceCluster] = {}
    for place in rows:
        if place.display_label:
            index.setdefault(_normalize(place.display_label), place)
    return index


def resolve_place_queries(
    session: Session,
    user_id_hash: str,
    queries: list[str],
    provider: GeocodeProvider,
) -> ResolvedPlaces:
    """Resolve free-text place queries to place ids, creating missing ones.

    A query matches an existing saved place (case-insensitive label) or is
    geocoded (top hit) and saved as a manual place. The created label is the
    user's query; the geocoder label is kept as ``address`` for narration.
    Geocoder failures / no-hits leave the query ``unresolved`` (not a hard error).
    """
    existing = _existing_by_label(session, user_id_hash)
    place_ids: list[str] = []
    matched: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    unresolved: list[str] = []

    for query in queries:
        key = _normalize(query)
        if not key:
            continue
        if key in existing:
            place = existing[key]
            place_ids.append(place.id)
            matched.append({"query": query, "place_id": place.id, "label": place.display_label})
            continue
        try:
            hits = provider.search(query)
        except GeocoderUpstreamError:
            unresolved.append(query)
            continue
        if not hits:
            unresolved.append(query)
            continue
        hit = hits[0]
        place = create_manual_place(
            session,
            user_id_hash,
            ManualPlaceCreate(
                display_label=query.strip(),
                latitude=hit.latitude,
                longitude=hit.longitude,
            ),
        )
        place_ids.append(place.id)
        created.append(
            {
                "query": query,
                "place_id": place.id,
                "label": place.display_label,
                "address": hit.label,
                "source": hit.source,
            }
        )
        existing[key] = session.get(PlaceCluster, place.id)  # dedupe repeats in one call

    return ResolvedPlaces(place_ids=place_ids, matched=matched, created=created, unresolved=unresolved)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_place_resolution.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/assistant/place_resolution.py tests/test_place_resolution.py
git commit -m "feat(assistant): shared place-name resolver (match or geocode+create)"
```

---

### Task A2: Workflow-tool argument models + `add_place`

Add the assistant argument models and the first workflow tool. `add_place` resolves one query and returns the created/matched place plus a resolution log.

**Files:**
- Modify: `app/assistant/tools.py` (add imports, arg models, a `build_provider` seam, `_add_place`, and the `add_place` branch in `execute_tool`)
- Test: `tests/test_assistant_tools.py` (add `add_place` test)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_assistant_tools.py  (add at end; reuse existing imports)
from app.geocoding.providers import GeocodeHit


class _FakeProvider:
    def __init__(self, hits):
        self._hits = hits

    def search(self, query):
        return self._hits


def test_add_place_geocodes_and_creates(tmp_path, monkeypatch):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr(
        "app.assistant.tools.build_provider",
        lambda settings: _FakeProvider(
            [GeocodeHit(label="Pike Place Market, Seattle", latitude=47.6097, longitude=-122.3422, source="nominatim")]
        ),
    )
    try:
        result = execute_tool(session, user_hash, "add_place", {"query": "Pike Place Market"})
    finally:
        session.close()
    assert result["tool_name"] == "add_place"
    payload = result["result"]
    assert payload["created"] is True
    assert payload["place"]["display_label"] == "Pike Place Market"
    assert payload["address"] == "Pike Place Market, Seattle"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_add_place_geocodes_and_creates -v`
Expected: FAIL with `AssistantToolError: Unknown assistant tool: add_place`

- [ ] **Step 3: Add the arg models, the provider seam, `_add_place`, and the branch**

In `app/assistant/tools.py`, add these imports near the top (after the existing imports):

```python
from datetime import date

from app.assistant.place_resolution import ResolvedPlaces, resolve_place_queries
from app.geocoding.providers import build_provider
from app.services.manual_place_service import _place_response
from app.models import PlaceCluster
```

Add the argument models below `EmptyArgs`:

```python
class AddPlaceArgs(BaseModel):
    query: str = Field(min_length=1)


class SelectPlacesArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    mode: str = "replace"


class AnalyzePlacesArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    place_ids: list[str] = Field(default_factory=list)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[int] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class ComparePlacesByNameArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    place_ids: list[str] = Field(default_factory=list)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: int = Field(gt=0, le=5000)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
```

Add the `_add_place` helper (above `execute_tool`):

```python
def _add_place(session: Session, user_id_hash: str, query: str) -> dict[str, Any]:
    provider = build_provider(get_settings())
    resolved = resolve_place_queries(session, user_id_hash, [query], provider)
    if not resolved.place_ids:
        raise AssistantToolError(f"Could not find a place for '{query}'.")
    place_id = resolved.place_ids[0]
    place = session.get(PlaceCluster, place_id)
    was_created = any(entry["place_id"] == place_id for entry in resolved.created)
    address = next(
        (entry["address"] for entry in resolved.created if entry["place_id"] == place_id),
        None,
    )
    return {
        "place": _place_response(place).model_dump(mode="json"),
        "place_id": place_id,
        "created": was_created,
        "address": address,
    }
```

Add the branch inside `execute_tool`'s `try` (before the `else: raise` clause):

```python
        elif tool_name == "add_place":
            args = AddPlaceArgs.model_validate(arguments)
            result = _add_place(session, user_id_hash, args.query)
            validated_arguments = args.model_dump(mode="json")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_add_place_geocodes_and_creates -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/assistant/tools.py tests/test_assistant_tools.py
git commit -m "feat(assistant): add_place tool + workflow arg models"
```

---

### Task A3: `select_places` tool

Resolve queries to ids and return them with the requested selection `mode` (replace/add/clear) for the frontend to apply.

**Files:**
- Modify: `app/assistant/tools.py`
- Test: `tests/test_assistant_tools.py`

- [ ] **Step 1: Write the failing test**

```python
def test_select_places_resolves_and_passes_mode(tmp_path, monkeypatch):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr(
        "app.assistant.tools.build_provider",
        lambda settings: _FakeProvider([]),  # "Library stop" already exists, no geocode needed
    )
    try:
        result = execute_tool(
            session, user_hash, "select_places", {"queries": ["Library stop"], "mode": "replace"}
        )
    finally:
        session.close()
    assert result["tool_name"] == "select_places"
    assert result["result"]["place_ids"] == ["place-1"]
    assert result["result"]["mode"] == "replace"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_select_places_resolves_and_passes_mode -v`
Expected: FAIL with `AssistantToolError: Unknown assistant tool: select_places`

- [ ] **Step 3: Add `_select_places` and the branch**

```python
def _select_places(session: Session, user_id_hash: str, queries: list[str], mode: str) -> dict[str, Any]:
    normalized_mode = mode if mode in {"replace", "add", "clear"} else "replace"
    if normalized_mode == "clear":
        return {"place_ids": [], "mode": "clear", "created": [], "unresolved": []}
    provider = build_provider(get_settings())
    resolved = resolve_place_queries(session, user_id_hash, queries, provider)
    return {
        "place_ids": resolved.place_ids,
        "mode": normalized_mode,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
    }
```

Branch in `execute_tool`:

```python
        elif tool_name == "select_places":
            args = SelectPlacesArgs.model_validate(arguments)
            result = _select_places(session, user_id_hash, args.queries, args.mode)
            validated_arguments = args.model_dump(mode="json")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_select_places_resolves_and_passes_mode -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/assistant/tools.py tests/test_assistant_tools.py
git commit -m "feat(assistant): select_places tool with replace/add/clear mode"
```

---

### Task A4: `analyze_places` tool (bundles analysis + neighborhood + incidents)

Resolve queries (or use backfilled selection), run + persist the analysis, and return the whole Analyze tab in one payload, plus `settings_used` so the frontend can sync its chips.

**Files:**
- Modify: `app/assistant/tools.py`
- Test: `tests/test_assistant_tools.py`

- [ ] **Step 1: Write the failing test**

```python
def test_analyze_places_bundles_neighborhood_and_incidents(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    try:
        result = execute_tool(
            session,
            user_hash,
            "analyze_places",
            {
                "place_ids": [place_id],  # no queries -> use selection
                "analysis_start_date": "2026-01-01",
                "analysis_end_date": "2026-06-30",
                "radii_m": [250],
            },
        )
    finally:
        session.close()
    payload = result["result"]
    assert result["tool_name"] == "analyze_places"
    assert payload["place_ids"] == [place_id]
    assert payload["settings_used"]["radius_m"] == 250
    assert payload["analysis"]["summary_count"] >= 1
    assert payload["neighborhood"]["places"][0]["beat"] == "M3"
    assert "incidents" in payload
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_analyze_places_bundles_neighborhood_and_incidents -v`
Expected: FAIL with `AssistantToolError: Unknown assistant tool: analyze_places`

- [ ] **Step 3: Add a shared resolve-or-select helper, `_analyze_places`, and the branch**

```python
def _resolve_or_select(
    session: Session,
    user_id_hash: str,
    queries: list[str],
    place_ids: list[str],
) -> ResolvedPlaces:
    """Prefer model-named queries; fall back to the backfilled selection ids."""
    if queries:
        provider = build_provider(get_settings())
        return resolve_place_queries(session, user_id_hash, queries, provider)
    return ResolvedPlaces(place_ids=list(place_ids))


def _settings_used(args: AnalyzePlacesArgs | ComparePlacesByNameArgs, radius_m: int) -> dict[str, Any]:
    return {
        "radius_m": radius_m,
        "analysis_start_date": args.analysis_start_date.isoformat(),
        "analysis_end_date": args.analysis_end_date.isoformat(),
        "offense_category": args.offense_category,
    }


def _analyze_places(session: Session, user_id_hash: str, args: AnalyzePlacesArgs) -> dict[str, Any]:
    resolved = _resolve_or_select(session, user_id_hash, args.queries, args.place_ids)
    if not resolved.place_ids:
        raise AssistantToolError("Name a place to analyze, or select one on the dashboard.")
    radii = list(dict.fromkeys(args.radii_m))
    radius_m = radii[0]
    analysis = analyze_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=radii,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
    )
    neighborhood = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radius_m=radius_m,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        area_lookup=_beat_areas(),
        beat_polygons=_beat_polygons(),
    )
    incidents = incident_details_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=[radius_m],
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        limit=AGENT_INCIDENT_LIMIT,
    )
    return {
        "place_ids": resolved.place_ids,
        "settings_used": _settings_used(args, radius_m),
        "analysis": analysis,
        "neighborhood": neighborhood,
        "incidents": incidents,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
    }
```

Branch in `execute_tool`:

```python
        elif tool_name == "analyze_places":
            args = AnalyzePlacesArgs.model_validate(arguments)
            result = _analyze_places(session, user_id_hash, args)
            validated_arguments = args.model_dump(mode="json")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_analyze_places_bundles_neighborhood_and_incidents -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/assistant/tools.py tests/test_assistant_tools.py
git commit -m "feat(assistant): analyze_places tool bundling neighborhood + incidents"
```

---

### Task A5: Evolve `compare_places` to resolve names and persist analysis

Replace the existing `compare_places` branch so it accepts `queries` (or selection), persists an analysis run at the compare radius (so the dashboard summary populates the cards), then runs the comparison.

**Files:**
- Modify: `app/assistant/tools.py` (replace the existing `compare_places` branch)
- Test: `tests/test_assistant_tools.py`

- [ ] **Step 1: Write the failing test**

```python
def test_compare_places_by_name_persists_analysis_and_compares(tmp_path, monkeypatch):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # Add a second place so a comparison is possible.
    session.add(
        PlaceCluster(
            id="place-2",
            user_id_hash=user_hash,
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.62,
            centroid_longitude=-122.34,
            display_latitude=47.62,
            display_longitude=-122.34,
            visit_count=1,
            sensitivity_class="normal",
            display_label="Second stop",
            inferred_place_type="manual_place",
            label_source="manual",
        )
    )
    session.commit()
    monkeypatch.setattr("app.assistant.tools.build_provider", lambda settings: _FakeProvider([]))
    try:
        result = execute_tool(
            session,
            user_hash,
            "compare_places",
            {
                "queries": ["Library stop", "Second stop"],
                "analysis_start_date": "2024-01-01",
                "analysis_end_date": "2024-01-31",
                "radius_m": 250,
                "offense_category": "PROPERTY",
            },
        )
    finally:
        session.close()
    payload = result["result"]
    assert result["tool_name"] == "compare_places"
    assert sorted(payload["place_ids"]) == ["place-1", "place-2"]
    assert payload["settings_used"]["radius_m"] == 250
    assert "comparison" in payload
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_compare_places_by_name_persists_analysis_and_compares -v`
Expected: FAIL — the current `compare_places` branch uses `DashboardCompareRequest` (no `queries`, requires `place_ids`), so validation raises `AssistantToolError`.

- [ ] **Step 3: Add `_compare_places` and replace the branch**

```python
def _compare_places(session: Session, user_id_hash: str, args: ComparePlacesByNameArgs) -> dict[str, Any]:
    resolved = _resolve_or_select(session, user_id_hash, args.queries, args.place_ids)
    if len(resolved.place_ids) < 2:
        raise AssistantToolError("Name at least two places to compare.")
    # Persist an analysis run at this radius so the dashboard summary has rows for the cards.
    analyze_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=[args.radius_m],
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
    )
    comparison = compare_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radius_m=args.radius_m,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
    )
    return {
        "place_ids": resolved.place_ids,
        "settings_used": _settings_used(args, args.radius_m),
        "comparison": comparison,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
    }
```

Replace the existing `compare_places` branch with:

```python
        elif tool_name == "compare_places":
            args = ComparePlacesByNameArgs.model_validate(arguments)
            result = _compare_places(session, user_id_hash, args)
            validated_arguments = args.model_dump(mode="json")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_compare_places_by_name_persists_analysis_and_compares -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/assistant/tools.py tests/test_assistant_tools.py
git commit -m "feat(assistant): compare_places resolves names and persists analysis"
```

---

### Task A6: Advertise the 6-tool menu, wire backfill, update the prompt

Shrink the advertised tool menu to the six PoC tools, make `analyze_places` a selection tool so settings backfill, and teach the planner to extract names into `queries` and narrate what it created.

**Files:**
- Modify: `app/assistant/semantic_layer.py` (`AVAILABLE_TOOLS`)
- Modify: `app/assistant/agent.py` (`SELECTION_TOOLS`)
- Modify: `app/assistant/prompts.py` (`PLANNING_SYSTEM_PROMPT`)
- Test: `tests/test_assistant_tools.py` (update advertised-menu test), `tests/test_assistant_agent.py` (backfill for analyze_places)

- [ ] **Step 1: Update the advertised-menu test and add a backfill test**

Replace `test_neighborhood_tool_is_advertised_to_the_model` in `tests/test_assistant_tools.py` with:

```python
def test_advertised_menu_is_the_six_poc_tools():
    from app.assistant.semantic_layer import AVAILABLE_TOOLS

    names = {tool["name"] for tool in AVAILABLE_TOOLS}
    assert names == {
        "add_place",
        "select_places",
        "analyze_places",
        "compare_places",
        "get_dashboard_summary",
        "suggest_followups",
    }
```

Add to `tests/test_assistant_agent.py`:

```python
def test_analyze_places_args_are_backfilled_from_dashboard_state():
    from app.assistant.agent import _tool_arguments

    state = AssistantDashboardState(
        selected_place_ids=["place-1"],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m=[250, 250],
        offense_category="PROPERTY",
    )
    # Model named a place -> queries preserved; selection/settings still backfilled.
    args = _tool_arguments("analyze_places", state, {"queries": ["Pike Place"]})

    assert args["queries"] == ["Pike Place"]
    assert args["place_ids"] == ["place-1"]
    assert args["radii_m"] == [250]
    assert args["analysis_start_date"] == "2024-01-01"
    assert args["offense_category"] == "PROPERTY"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py::test_advertised_menu_is_the_six_poc_tools tests/test_assistant_agent.py::test_analyze_places_args_are_backfilled_from_dashboard_state -v`
Expected: FAIL (menu still lists the old tools; `analyze_places` not in `SELECTION_TOOLS`, so `place_ids` not backfilled)

- [ ] **Step 3: Apply the changes**

In `app/assistant/semantic_layer.py`, replace `AVAILABLE_TOOLS` with:

```python
AVAILABLE_TOOLS = [
    {
        "name": "add_place",
        "description": (
            "Find a place by name or address and save it. Pass the user's place "
            "name/address as 'query'."
        ),
    },
    {
        "name": "select_places",
        "description": (
            "Resolve place names to saved places (creating any missing) and set the "
            "current selection. Pass names as 'queries'; 'mode' is replace, add, or clear."
        ),
    },
    {
        "name": "analyze_places",
        "description": (
            "Resolve place names (or use the current selection), run the reported-incident "
            "analysis, and return the neighborhood-vs-beat verdicts and incident details. "
            "Pass names as 'queries'."
        ),
    },
    {
        "name": "compare_places",
        "description": (
            "Resolve two or more place names (or use the selection), run the analysis, and "
            "compare their reported-incident context. Pass names as 'queries'."
        ),
    },
    {
        "name": "get_dashboard_summary",
        "description": "Read current dashboard totals and saved places.",
    },
    {
        "name": "suggest_followups",
        "description": "Suggest deterministic follow-up questions.",
    },
]
```

In `app/assistant/agent.py`, update `SELECTION_TOOLS`:

```python
SELECTION_TOOLS = (
    "run_place_analysis",
    "compare_places",
    "get_neighborhood_analysis",
    "get_incident_details",
    "analyze_places",
)
```

In `app/assistant/prompts.py`, append to `PLANNING_SYSTEM_PROMPT` (before the JSON-contract lines beginning "During planning"):

```python
When the user names places or addresses, pass them as a "queries" list to the
workflow tool (add_place, select_places, analyze_places, compare_places); do not
ask the user to select them first. After a tool resolves or creates places, state
plainly in your final answer what you found or created (for example, "Found
Capitol Hill at 10th & Pine and saved it").
```

- [ ] **Step 4: Run the full assistant suite**

Run: `PYTHONPATH=. .venv/bin/pytest tests/test_assistant_tools.py tests/test_assistant_agent.py tests/test_assistant_api.py tests/test_assistant_semantic_layer.py -v`
Expected: PASS (the existing `run_place_analysis` / `get_incident_details` / `get_neighborhood_analysis` execute_tool tests still pass — those branches remain in the registry — and `test_planning_prompt_requests_statistical_interpretation` still passes because the original lines are unchanged)

- [ ] **Step 5: Commit**

```bash
git add app/assistant/semantic_layer.py app/assistant/agent.py app/assistant/prompts.py tests/
git commit -m "feat(assistant): advertise 6-tool menu, backfill analyze_places, prompt for name extraction"
```

---

### Task A7: Backend gate

- [ ] **Step 1: Run lint + the full backend suite**

Run:
```bash
PYTHONPATH=. .venv/bin/ruff check .
PYTHONPATH=. .venv/bin/pytest -q
```
Expected: ruff clean; all tests pass. Fix any failures before continuing.

- [ ] **Step 2: Commit any lint fixes**

```bash
git add -A && git commit -m "chore(assistant): lint fixes for pane-analysis tools" || echo "nothing to commit"
```

---

## Part B — Frontend: the bridge

Part B consumes the Task A result shapes: `add_place` → `{place:{id,...}, created, address}`; `select_places` → `{place_ids, mode}`; `analyze_places` → `{place_ids, settings_used:{radius_m, analysis_start_date, analysis_end_date, offense_category}, neighborhood, incidents}`; `compare_places` → `{place_ids, settings_used, comparison}`.

### Task B1: Pure tool-result interpreter + types

A pure function maps a `tool` event's `data` to a normalized effect the workspace applies. Pure = unit-testable without React.

**Files:**
- Modify: `frontend/src/types.ts` (add `AssistantToolEffect`)
- Create: `frontend/src/lib/assistantBridge.ts`
- Test: `frontend/src/lib/assistantBridge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/assistantBridge.test.ts
import { describe, expect, it } from "vitest";
import { interpretToolResult } from "./assistantBridge";

describe("interpretToolResult", () => {
  it("maps compare_places to a replace-selection + compare effect on the Compare tab", () => {
    const effect = interpretToolResult({
      tool_name: "compare_places",
      result: {
        place_ids: ["a", "b"],
        settings_used: {
          radius_m: 500,
          analysis_start_date: "2026-01-01",
          analysis_end_date: "2026-06-30",
          offense_category: "PROPERTY",
        },
        comparison: { overview: { summary_text: "more incidents at a" } },
      },
    });
    expect(effect).toEqual({
      selection: { mode: "replace", ids: ["a", "b"] },
      settings: { radiusM: 500, startDate: "2026-01-01", endDate: "2026-06-30", offenseCategory: "PROPERTY" },
      comparison: { overview: { summary_text: "more incidents at a" } },
      refetchSummary: true,
      tab: "compare",
    });
  });

  it("maps analyze_places to neighborhood + incidents on the Analyze tab", () => {
    const effect = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        neighborhood: { radius_m: 250, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 },
      },
    });
    expect(effect?.tab).toBe("analyze");
    expect(effect?.selection).toEqual({ mode: "replace", ids: ["a"] });
    expect(effect?.settings?.radiusM).toBe(250);
    expect(effect?.settings?.offenseCategory).toBe("");
    expect(effect?.neighborhood).toEqual({ radius_m: 250, places: [], pairwise: [] });
    expect(effect?.refetchSummary).toBe(true);
  });

  it("maps add_place to an append-selection effect", () => {
    const effect = interpretToolResult({
      tool_name: "add_place",
      result: { place: { id: "new-1" }, created: true, address: "somewhere" },
    });
    expect(effect).toEqual({ selection: { mode: "add", ids: ["new-1"] }, refetchSummary: true });
  });

  it("maps select_places, honoring mode", () => {
    expect(interpretToolResult({ tool_name: "select_places", result: { place_ids: [], mode: "clear" } }))
      .toEqual({ selection: { mode: "clear", ids: [] } });
  });

  it("returns null for read-only or unknown tools", () => {
    expect(interpretToolResult({ tool_name: "get_dashboard_summary", result: {} })).toBeNull();
    expect(interpretToolResult({ tool_name: "mystery", result: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- assistantBridge`
Expected: FAIL — `interpretToolResult` does not exist.

- [ ] **Step 3: Add the type and the interpreter**

Append to `frontend/src/types.ts`:

```ts
export type AssistantToolEffect = {
  selection?: { mode: "replace" | "add" | "clear"; ids: string[] };
  settings?: Partial<AnalysisSettings>;
  comparison?: Record<string, unknown> | null;
  neighborhood?: NeighborhoodAnalysis | null;
  incidents?: IncidentDetailsResponse | null;
  refetchSummary?: boolean;
  tab?: TabKey;
};
```

Create `frontend/src/lib/assistantBridge.ts`:

```ts
import type {
  AnalysisSettings,
  AssistantToolEffect,
  IncidentDetailsResponse,
  NeighborhoodAnalysis,
} from "../types";

type SettingsUsed = {
  radius_m?: number;
  analysis_start_date?: string;
  analysis_end_date?: string;
  offense_category?: string | null;
};

function settingsFrom(used: SettingsUsed | undefined): Partial<AnalysisSettings> {
  if (!used) return {};
  const patch: Partial<AnalysisSettings> = {};
  if (typeof used.radius_m === "number") patch.radiusM = used.radius_m;
  if (typeof used.analysis_start_date === "string") patch.startDate = used.analysis_start_date;
  if (typeof used.analysis_end_date === "string") patch.endDate = used.analysis_end_date;
  // offense_category is null for "all reported"; the UI represents that as "".
  if (used.offense_category !== undefined) patch.offenseCategory = used.offense_category ?? "";
  return patch;
}

export function interpretToolResult(data: {
  tool_name?: string;
  result?: unknown;
}): AssistantToolEffect | null {
  const result = (data.result ?? {}) as Record<string, unknown>;
  switch (data.tool_name) {
    case "compare_places":
      return {
        selection: { mode: "replace", ids: (result.place_ids as string[]) ?? [] },
        settings: settingsFrom(result.settings_used as SettingsUsed),
        comparison: (result.comparison as Record<string, unknown>) ?? null,
        refetchSummary: true,
        tab: "compare",
      };
    case "analyze_places":
      return {
        selection: { mode: "replace", ids: (result.place_ids as string[]) ?? [] },
        settings: settingsFrom(result.settings_used as SettingsUsed),
        neighborhood: (result.neighborhood as NeighborhoodAnalysis) ?? null,
        incidents: (result.incidents as IncidentDetailsResponse) ?? null,
        refetchSummary: true,
        tab: "analyze",
      };
    case "add_place": {
      const place = (result.place ?? {}) as { id?: string };
      if (!place.id) return null;
      return { selection: { mode: "add", ids: [place.id] }, refetchSummary: true };
    }
    case "select_places":
      return {
        selection: {
          mode: (result.mode as "replace" | "add" | "clear") ?? "replace",
          ids: (result.place_ids as string[]) ?? [],
        },
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- assistantBridge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/assistantBridge.ts frontend/src/lib/assistantBridge.test.ts
git commit -m "feat(frontend): pure tool-result interpreter for the assistant bridge"
```

---

### Task B2: Forward tool results from `AssistantPanel`

Add an optional `onToolResult` callback fired from the existing `tool` SSE handler with the whole `event.data`. Keep the existing tool-activity chip behavior.

**Files:**
- Modify: `frontend/src/components/AssistantPanel.tsx`
- Test: `frontend/src/components/AssistantPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// add inside the existing describe("AssistantPanel", ...) block
it("forwards tool result data to onToolResult", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    sseResponse(
      'event: tool\ndata: {"tool_name":"compare_places","result":{"place_ids":["a","b"]}}\n\n' +
        'event: token\ndata: {"delta":"done"}\n\n' +
        "event: done\ndata: {}\n\n",
    ),
  );
  const onToolResult = vi.fn();
  render(<AssistantPanel dashboardState={dashboardState} onToolResult={onToolResult} />);
  fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("done");
  expect(onToolResult).toHaveBeenCalledWith(
    expect.objectContaining({ tool_name: "compare_places", result: { place_ids: ["a", "b"] } }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- AssistantPanel`
Expected: FAIL — `onToolResult` is not a prop and is never called.

- [ ] **Step 3: Add the prop and call it**

In `frontend/src/components/AssistantPanel.tsx`, update `Props` and the `tool` handler:

```tsx
type Props = {
  dashboardState: AssistantDashboardState;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
};
```

```tsx
export function AssistantPanel({ dashboardState, onToolResult }: Props) {
```

In the `onEvent` handler, change the `tool` branch to also forward the data:

```tsx
            if (event.event === "tool") {
              const toolName = String(event.data.tool_name ?? "tool");
              setToolActivity((current) => [{ label: toolName }, ...current].slice(0, 4));
              onToolResult?.(event.data);
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- AssistantPanel`
Expected: PASS (existing AssistantPanel tests still pass — `onToolResult` is optional)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssistantPanel.tsx frontend/src/components/AssistantPanel.test.tsx
git commit -m "feat(frontend): AssistantPanel forwards tool results via onToolResult"
```

---

### Task B3: Apply the effect in `MapWorkspace`

Wire `applyAssistantToolResult` into `MapWorkspace`: apply settings, then selection (directly, NOT via `selectPlaceIds`, so the analysis-context invalidation does not wipe the result we set next), then the result slices, then refetch + switch tab.

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/components/MapWorkspace.test.tsx` (add a focused integration test)

- [ ] **Step 1: Write the failing test**

The existing `MapWorkspace.test.tsx` mocks `../api/client` (not global fetch) and renders the real `AssistantPanel`. That mock does NOT currently include `streamAssistantChat`, so add it and drive `onEvent` directly.

(a) Add `streamAssistantChat: vi.fn(),` to the `vi.mock("../api/client", () => ({ ... }))` object (the block at lines ~17–28).

(b) Add `streamAssistantChat` to the named import from `../api/client` (the line ~31).

(c) Add this test inside `describe("MapWorkspace", ...)`:

```ts
it("opens the Compare tab with the overview when the assistant returns compare_places", async () => {
  const a: Place = { ...home, id: "a", display_label: "Alpha" };
  const b: Place = { ...work, id: "b", display_label: "Bravo" };
  vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
  vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([a, b]));
  vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
    handlers.onEvent({
      event: "tool",
      data: {
        tool_name: "compare_places",
        result: {
          place_ids: ["a", "b"],
          settings_used: {
            radius_m: 250,
            analysis_start_date: "2026-01-01",
            analysis_end_date: "2026-06-30",
            offense_category: null,
          },
          comparison: { overview: { summary_text: "More reported incidents at Alpha." } },
        },
      },
    });
    handlers.onEvent({ event: "token", data: { delta: "Compared Alpha and Bravo." } });
    handlers.onEvent({ event: "done", data: {} });
  });

  render(<MapWorkspace />);
  await screen.findByText("Alpha");

  fireEvent.change(screen.getByLabelText("Analyst message"), {
    target: { value: "compare Alpha and Bravo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  // Only resolves if the bridge replaced the selection (so CompareTab has 2 places),
  // set the comparison, and switched to the Compare tab.
  expect(await screen.findByText("More reported incidents at Alpha.")).toBeInTheDocument();
});
```

(`streamAssistantChat` must be imported in this file so `vi.mocked(streamAssistantChat)` resolves; the `Place` type is already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- MapWorkspace`
Expected: FAIL — `MapWorkspace` does not yet pass `onToolResult` to `AssistantPanel`, so the tool event is received but never applied; `findByText` times out.

- [ ] **Step 3: Add `applyAssistantToolResult` and wire it**

In `frontend/src/components/MapWorkspace.tsx`, add the import:

```tsx
import { interpretToolResult } from "../lib/assistantBridge";
```

Add the handler (near the other handlers, after `selectPlaceIds`):

```tsx
function applyAssistantToolResult(data: { tool_name?: string; result?: unknown }) {
  const effect = interpretToolResult(data);
  if (!effect) return;
  if (effect.settings) {
    setAnalysis((current) => ({ ...current, ...effect.settings }));
  }
  if (effect.selection) {
    const { mode, ids } = effect.selection;
    setSelectedIds((current) => {
      if (mode === "clear") return new Set<string>();
      if (mode === "replace") return new Set(ids);
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }
  // Set result slices AFTER selection (we did NOT call invalidateAnalysisContext, so they stick).
  if (effect.comparison !== undefined) setComparison(effect.comparison);
  if (effect.neighborhood !== undefined) setNeighborhood(effect.neighborhood);
  if (effect.incidents !== undefined) setIncidentDetails(effect.incidents);
  if (effect.refetchSummary) {
    void refreshWithFallback("Analyst updated the view, but dashboard totals could not refresh.");
  }
  if (effect.tab) setActiveTab(effect.tab);
}
```

Wire it into the panel render:

```tsx
        <AssistantPanel dashboardState={assistantState} onToolResult={applyAssistantToolResult} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- MapWorkspace`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(frontend): MapWorkspace applies assistant tool results to the pane"
```

---

### Task B4: Frontend gate

- [ ] **Step 1: Run the full frontend gate**

Run:
```bash
cd frontend && npm test && npm run lint && npm run build
```
Expected: all tests pass, lint clean, build succeeds. Fix any failures.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A && git commit -m "chore(frontend): lint/type fixes for the assistant bridge" || echo "nothing to commit"
```

---

## Task C: End-to-end verification

- [ ] **Step 1: Full repo gate**

Run from the worktree root:
```bash
PYTHONPATH=. .venv/bin/ruff check . && PYTHONPATH=. .venv/bin/pytest -q
cd frontend && npm test && npm run build
```
(Equivalent to `make test-all`.) Expected: all green.

- [ ] **Step 2: Manual smoke (optional but recommended)**

With a live LLM endpoint + geocoder configured, run `make run`, open the app, and in the analyst box type: "compare Pike Place Market and Capitol Hill". Expected: the assistant narrates what it resolved/created, the Compare tab opens, and the cards show counts. Then try "analyze my home" → Analyze tab fills.

- [ ] **Step 3: Final commit / push**

```bash
git status
# push the branch only when the user asks
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Shared resolver (saved + geocode + auto-save) → Task A1.
- 6-tool toolbox (add_place, select_places, analyze_places bundling neighborhood+incidents, compare_places, get_dashboard_summary, suggest_followups) → Tasks A2–A6.
- Settings inheritance / backfill → Task A6.
- Prompt name-extraction + transparency narration → Task A6.
- Frontend bridge (one coordinated action, replace selection, sync radius, ordering) → Tasks B1–B3.
- Minimal enrichment (reuse existing tabs) → no new pane UI; covered by reusing CompareTab/AnalyzeTab.
- Invariant preserved → safety guard untouched; resolver/tools are neutral; existing guard tests remain.
- Testing requirements → resolver tests (A1), tool tests (A2–A5), menu/backfill tests (A6), interpreter tests (B1), panel forwarding (B2), workspace integration (B3), gates (A7/B4/C).

**Placeholder scan:** The only deferred detail is matching `MapWorkspace.test.tsx`'s existing client mock in B3 (flagged with an implementer note), because the exact mock wiring must mirror that file; all code steps include real code.

**Type consistency:** `settings_used` keys (`radius_m`, `analysis_start_date`, `analysis_end_date`, `offense_category`) are produced by `_settings_used` (A4) and consumed by `settingsFrom` (B1); `AssistantToolEffect` fields match between `types.ts` (B1) and `applyAssistantToolResult` (B3); the `place_ids` / `place` / `mode` result keys match between the tools (A2–A5) and `interpretToolResult` (B1).

**Out-of-PoC (per spec non-goals):** Routes/Export tools, `set_analysis_settings`, `delete_place`, richer enrichment, autonomous place selection — not in this plan.
