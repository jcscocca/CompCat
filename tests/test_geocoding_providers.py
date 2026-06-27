from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.geocoding.providers import (
    GeocodeHit,
    GeocoderUpstreamError,
    NominatimProvider,
    build_provider,
)


def _provider_with_transport(handler) -> NominatimProvider:
    return NominatimProvider(
        base_url="https://nominatim.example/search",
        user_agent="Waypoint/0.1 (ops@example.com)",
        max_results=5,
        timeout_s=5.0,
        transport=httpx.MockTransport(handler),
    )


def test_nominatim_provider_maps_rows_to_hits():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["q"] == "pike place"
        assert request.url.params["format"] == "jsonv2"
        assert request.headers["User-Agent"] == "Waypoint/0.1 (ops@example.com)"
        return httpx.Response(
            200,
            json=[
                {
                    "display_name": "Pike Place Market, Seattle",
                    "lat": "47.6097",
                    "lon": "-122.3331",
                }
            ],
        )

    provider = _provider_with_transport(handler)
    hits = provider.search("pike place")

    assert hits == [
        GeocodeHit(
            label="Pike Place Market, Seattle",
            latitude=47.6097,
            longitude=-122.3331,
            source="nominatim",
        )
    ]


def test_nominatim_provider_wraps_transport_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    provider = _provider_with_transport(handler)
    with pytest.raises(GeocoderUpstreamError):
        provider.search("anything")


def test_nominatim_provider_wraps_error_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    provider = _provider_with_transport(handler)
    with pytest.raises(GeocoderUpstreamError):
        provider.search("anything")


def test_build_provider_returns_nominatim():
    settings = Settings(geocoder_contact_email="ops@example.com")
    provider = build_provider(settings)
    assert isinstance(provider, NominatimProvider)


def test_build_provider_rejects_unknown():
    settings = Settings(geocoder_provider="mystery")
    with pytest.raises(ValueError, match="mystery"):
        build_provider(settings)
