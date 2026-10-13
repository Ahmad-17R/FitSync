"""Application settings with environment variable support.

Trimmed to what the yoga pipeline actually reads. The original in
``shahmir2004/exercise-form-correction`` carries ~40 more knobs — Kalman noise,
HMM transition probabilities, rep-detection thresholds, violation aggregation,
Supabase credentials, exercise-switch tuning — none of which any module in this
server names. Keeping them would have meant shipping configuration that cannot
affect anything, which is worse than no documentation at all.
"""

import os
from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def get_cors_origins() -> List[str]:
    """Parse CORS_ORIGINS from the environment, or return the dev defaults."""
    env_value = os.environ.get("CORS_ORIGINS", "")
    if env_value:
        # Special case: allow all origins.
        if env_value.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in env_value.split(",") if origin.strip()]
    return [
        "http://localhost:3000",
        "http://localhost:5173",
    ]


class Settings(BaseSettings):
    """Application configuration settings."""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # Logging — per-frame DEBUG lines when true, state transitions only when false.
    DETECTION_DEBUG_LOG: bool = False

    # Security / limits
    MAX_CLIENT_ID_LENGTH: int = 80

    # CORS. Note that a wildcard entry inside CORS_ORIGINS ("https://*.vercel.app")
    # matches nothing: CORSMiddleware compares that list as exact strings. Preview
    # deployments need CORS_ORIGIN_REGEX instead.
    CORS_ALLOW_CREDENTIALS: bool = False
    CORS_ORIGIN_REGEX: Optional[str] = None

    # Yoga hold timing.
    #
    # The debounce is counted in FRAMES, not seconds, so it has to be read
    # against the client's frame rate. FitSync streams at 12fps, which makes the
    # default about 0.8s of grace before a wobble resets a hold. A client
    # streaming slower needs a lower number or the grace window becomes
    # uncomfortably long.
    YOGA_HOLD_DEBOUNCE_FRAMES: int = 10
    YOGA_DEFAULT_HOLD_SECONDS: float = 20.0

    @property
    def CORS_ORIGINS(self) -> List[str]:
        """Get CORS origins from the environment."""
        return get_cors_origins()

    @property
    def EFFECTIVE_CORS_ALLOW_CREDENTIALS(self) -> bool:
        """Wildcard CORS cannot be safely combined with credentials."""
        return self.CORS_ALLOW_CREDENTIALS and "*" not in self.CORS_ORIGINS

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value):
        """Accept deployment env labels commonly used for non-debug builds."""
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "production", "prod"}:
                return False
            if normalized in {"debug", "development", "dev"}:
                return True
        return value


settings = Settings()
