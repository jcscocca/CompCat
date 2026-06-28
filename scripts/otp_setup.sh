#!/usr/bin/env bash
#
# Stand up OpenTripPlanner 2.x (Seattle / Puget Sound) in Docker on Linux/macOS, for
# Waypoint's live routing provider (MCA_ROUTING_PROVIDER=opentripplanner). Cross-platform
# equivalent of scripts/otp_thinkpad_setup.ps1.
#
# Downloads the OSM extract + GTFS feed (if missing), builds the OTP graph, and starts a
# container named "otp" with a restart policy. Re-running is safe: it skips the download
# and build when the data / graph already exist (use --rebuild to force a fresh graph).
#
# Usage:
#   scripts/otp_setup.sh [--data-dir DIR] [--port N] [--heap 8g] [--rebuild]
#   OTP_DATA_DIR=~/otp OTP_PORT=8090 OTP_HEAP=8g scripts/otp_setup.sh
set -euo pipefail

DATA_DIR="${OTP_DATA_DIR:-$HOME/otp}"
PORT="${OTP_PORT:-8090}"
HEAP="${OTP_HEAP:-8g}"
REBUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --heap) HEAP="$2"; shift 2 ;;
    --rebuild) REBUILD=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

IMAGE="docker.io/opentripplanner/opentripplanner:latest"
OSM_URL="https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf"
GTFS_URL="https://gtfs.sound.obaweb.org/prod/gtfs_puget_sound_consolidated.zip"
OSM_FILE="$DATA_DIR/washington-latest.osm.pbf"
GTFS_FILE="$DATA_DIR/gtfs_puget_sound_consolidated.zip"  # filename must contain "gtfs"
GRAPH="$DATA_DIR/graph.obj"

command -v docker >/dev/null 2>&1 || { echo "Docker not found. Install Docker and retry." >&2; exit 1; }
docker version >/dev/null 2>&1 || { echo "Docker isn't responding — start Docker and retry." >&2; exit 1; }

mkdir -p "$DATA_DIR"

download() {  # url, dest
  echo "==> Downloading $(basename "$2") (large — can take several minutes)..."
  curl -fL --retry 3 -o "$2" "$1"
}
[ -f "$OSM_FILE" ] || download "$OSM_URL" "$OSM_FILE"
[ -f "$GTFS_FILE" ] || download "$GTFS_URL" "$GTFS_FILE"

if [ "$REBUILD" = 1 ] || [ ! -f "$GRAPH" ]; then
  echo "==> Building the OTP graph (RAM/time-heavy)..."
  docker run --rm -e "JAVA_TOOL_OPTIONS=-Xmx$HEAP" -v "$DATA_DIR:/var/opentripplanner" "$IMAGE" --build --save
else
  echo "==> graph.obj already present — skipping build (use --rebuild to force)."
fi

echo "==> (Re)starting the 'otp' container on port $PORT..."
docker rm -f otp >/dev/null 2>&1 || true
docker run -d --name otp --restart unless-stopped -p "${PORT}:8080" \
  -e "JAVA_TOOL_OPTIONS=-Xmx$HEAP" -v "$DATA_DIR:/var/opentripplanner" "$IMAGE" --load --serve >/dev/null

# LAN-reachability hint (best effort across Linux/macOS). If your host runs a firewall,
# open the port yourself, e.g.:  sudo ufw allow ${PORT}/tcp
lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$lan_ip" ] || lan_ip="$(ipconfig getifaddr en0 2>/dev/null || true)"

echo
echo "OTP is starting. Watch it:   docker logs -f otp    (ready at 'Grizzly server running')"
echo "Local check:                 http://localhost:$PORT/graphiql"
echo
echo "Point Waypoint at it (set in .env.deploy, then restart the stack):"
echo "  MCA_ROUTING_PROVIDER=opentripplanner"
echo "  MCA_OPENTRIPPLANNER_BASE_URL=http://host.docker.internal:$PORT/otp/gtfs/v1"
if [ -n "$lan_ip" ]; then
  echo
  echo "(This host's LAN IP is $lan_ip — use http://${lan_ip}:$PORT/otp/gtfs/v1 from other machines.)"
fi
