# Tear down the demo instance (the tunnel dies with its Ctrl+C / window close).
$ErrorActionPreference = "Stop"
docker compose -p waypoint-demo -f docker-compose.yml -f docker-compose.demo.yml --env-file .env.demo down
Write-Host "Demo instance stopped. DB volume kept (docker volume rm waypoint-demo_* to wipe)."
