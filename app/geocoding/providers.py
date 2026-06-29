from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import httpx

if TYPE_CHECKING:
    from app.config import Settings


@dataclass(frozen=True)
class GeocodeHit:
    label: str
    latitude: float
    longitude: float
    source: str


class GeocoderUpstreamError(RuntimeError):
    """The upstream geocoder was unreachable or returned an error/bad shape."""


class GeocodeProvider(Protocol):
    def search(self, query: str) -> list[GeocodeHit]:
        ...


class NominatimProvider:
    def __init__(
        self,
        *,
        base_url: str,
        user_agent: str,
        max_results: int,
        timeout_s: float,
        viewbox: str = "",
        bounded: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url
        self.user_agent = user_agent
        self.max_results = max_results
        self.timeout_s = timeout_s
        self.viewbox = viewbox
        self.bounded = bounded
        self._transport = transport

    def search(self, query: str) -> list[GeocodeHit]:
        params = {"format": "jsonv2", "limit": self.max_results, "q": query}
        # Region-lock to the configured viewbox (e.g. Seattle metro). bounded=1 hard-restricts
        # results to the box so ambiguous names cannot resolve to another city.
        if self.viewbox:
            params["viewbox"] = self.viewbox
            if self.bounded:
                params["bounded"] = 1
        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        try:
            with httpx.Client(timeout=self.timeout_s, transport=self._transport) as client:
                response = client.get(self.base_url, params=params, headers=headers)
                response.raise_for_status()
                rows = response.json()
        except httpx.HTTPError as exc:
            raise GeocoderUpstreamError(f"Geocoder upstream unavailable: {exc}") from exc
        try:
            return [
                GeocodeHit(
                    label=row["display_name"],
                    latitude=float(row["lat"]),
                    longitude=float(row["lon"]),
                    source="nominatim",
                )
                for row in rows
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise GeocoderUpstreamError(
                f"Geocoder returned an unexpected response shape: {exc}"
            ) from exc


def _user_agent(settings: Settings) -> str:
    email = settings.geocoder_contact_email.strip()
    if email:
        return f"{settings.geocoder_user_agent} ({email})"
    return settings.geocoder_user_agent


def build_provider(settings: Settings) -> GeocodeProvider:
    if settings.geocoder_provider == "nominatim":
        return NominatimProvider(
            base_url=settings.geocoder_base_url,
            user_agent=_user_agent(settings),
            max_results=settings.geocoder_max_results,
            timeout_s=settings.geocoder_timeout_s,
            viewbox=settings.geocoder_viewbox,
            bounded=settings.geocoder_bounded,
        )
    raise ValueError(f"Unknown geocoder provider: {settings.geocoder_provider!r}")
