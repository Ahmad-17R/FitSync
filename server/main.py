"""FitSync — yoga form-check API.

A single WebSocket answering one question per frame: is the body in the
selected pose right now, how long has it been held, and what should be fixed.

This is the yoga half of ``shahmir2004/exercise-form-correction``, extracted so
the app can be deployed on its own. The exercise pipeline — HMM/k-NN movement
classification, rep counting, chunked video upload — is not here, and neither
are its dependencies. See ``docs/YOGA_API.md``.

No video ever reaches this server. Clients run MediaPipe in the browser and
send 33 landmark coordinates per frame; everything here is geometry and timing.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import settings
from api.yoga_routes import router as yoga_router
from api.search_routes import router as search_router


# Detection logging.
#   'detect' emits INFO for state transitions and completed holds — these show
#   up in Render's runtime logs. Per-frame DEBUG lines only when
#   DETECTION_DEBUG_LOG=true, which is far too noisy for anything but tuning.
_handler = logging.StreamHandler()
_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(name)s] %(levelname)s %(message)s", datefmt="%H:%M:%S")
)
_detect_logger = logging.getLogger("detect")
_detect_logger.handlers = [_handler]
_detect_logger.setLevel(logging.DEBUG if settings.DETECTION_DEBUG_LOG else logging.INFO)
_detect_logger.propagate = False


app = FastAPI(
    title="FitSync — Yoga Form Check API",
    description=(
        "Real-time yoga pose detection and hold timing from MediaPipe landmarks."
    ),
    version="1.0.0",
)

# Browsers do NOT preflight WebSocket handshakes, so a missing origin here fails
# in a confusing half-broken way: live coaching keeps working while
# GET /api/yoga/poses and /api/yoga/health are blocked. Configure it properly
# rather than trusting the socket to tell you.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=settings.EFFECTIVE_CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(yoga_router, prefix="/api")
app.include_router(search_router, prefix="/api")


@app.get("/")
async def root():
    """Service description."""
    return {
        "name": "FitSync — Yoga Form Check API",
        "version": "1.0.0",
        "docs": "/docs",
        "websocket": "/api/ws/yoga/{client_id}",
        "catalog": "/api/yoga/poses",
        "health": "/api/yoga/health",
        "reset": "/api/reset/yoga/{client_id}",
        "search": "/api/search?q=...&model=bm25f",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
