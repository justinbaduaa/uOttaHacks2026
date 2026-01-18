# src/lib/sentry.py
import os
import sentry_sdk
from sentry_sdk.integrations.aws_lambda import AwsLambdaIntegration

_INITIALIZED = False

def init_sentry() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return

    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        # No DSN set => Sentry disabled (common for local dev)
        return

    sentry_sdk.init(
        dsn=dsn,
        integrations=[AwsLambdaIntegration()],
        environment=os.getenv("SENTRY_ENV", "local"),
    debug=os.getenv("SENTRY_DEBUG", "false").lower() == "true",
    )
    _INITIALIZED = True
