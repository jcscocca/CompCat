from __future__ import annotations

from typing import Protocol

from app.routing.mock_provider import MockRoutingProvider
from app.routing.schemas import RouteAlternativeData, RouteRequestData


class RoutingProvider(Protocol):
    def get_routes(self, request: RouteRequestData) -> list[RouteAlternativeData]:
        """Return ranked provider alternatives for a normalized route request."""


class UnsupportedRoutingProviderError(ValueError):
    pass


class RoutingProviderError(RuntimeError):
    """A routing provider was reachable-in-principle but failed at request time."""


def get_routing_provider(
    provider_name: str, *, opentripplanner_base_url: str = ""
) -> RoutingProvider:
    if provider_name == "mock":
        return MockRoutingProvider()
    if provider_name == "opentripplanner":
        if not opentripplanner_base_url:
            raise UnsupportedRoutingProviderError(
                "OpenTripPlanner base URL is not configured."
            )
        from app.routing.opentripplanner_provider import OpenTripPlannerProvider

        return OpenTripPlannerProvider(opentripplanner_base_url)
    raise UnsupportedRoutingProviderError(f"Unsupported routing provider: {provider_name}")
