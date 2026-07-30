"""ASGI request-body limits enforced before FastAPI routing and multipart parsing."""

from __future__ import annotations

from tempfile import SpooledTemporaryFile

from app.ratelimit import _send_json

_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})
_REPLAY_CHUNK_BYTES = 64 * 1024
_SPOOL_MEMORY_BYTES = 1024 * 1024


class RequestBodyLimitMiddleware:
    """Reject oversized bodies before routing.

    Content-Length gives an immediate cheap rejection. Accepted bodies are still read
    through a bounded spool before the application is invoked, so a missing or dishonest
    Content-Length cannot bypass the limit. Large enabled uploads spill to disk instead
    of being duplicated in memory.
    """

    def __init__(self, app, *, get_settings_fn) -> None:
        self.app = app
        self._get_settings = get_settings_fn

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("method", "").upper() not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return

        settings = self._get_settings()
        path = scope.get("path", "")
        limit = settings.max_request_bytes
        if path == "/uploads" and settings.public_enable_personal_uploads:
            limit = settings.max_upload_bytes

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        content_length = headers.get("content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await _send_json(send, 400, {"detail": "Invalid Content-Length"})
                return
            if declared_length < 0:
                await _send_json(send, 400, {"detail": "Invalid Content-Length"})
                return
            if declared_length > limit:
                await _send_json(send, 413, {"detail": "Request body is too large"})
                return

        spool = SpooledTemporaryFile(max_size=_SPOOL_MEMORY_BYTES)
        total = 0
        try:
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body = message.get("body", b"")
                total += len(body)
                if total > limit:
                    await _send_json(send, 413, {"detail": "Request body is too large"})
                    return
                spool.write(body)
                if not message.get("more_body", False):
                    break

            spool.seek(0)
            replay_complete = False

            async def replay_receive() -> dict:
                nonlocal replay_complete
                if replay_complete:
                    return await receive()
                chunk = spool.read(_REPLAY_CHUNK_BYTES)
                replay_complete = spool.tell() >= total
                return {
                    "type": "http.request",
                    "body": chunk,
                    "more_body": not replay_complete,
                }

            await self.app(scope, replay_receive, send)
        finally:
            spool.close()
