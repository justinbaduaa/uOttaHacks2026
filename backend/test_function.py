import os
import sentry_sdk
from dotenv import load_dotenv

load_dotenv()

from src.lib.sentry import init_sentry
init_sentry()

# 1) Test message (guaranteed)
sentry_sdk.capture_message("SENTRY TEST MESSAGE from sentry_test.py")
sentry_sdk.flush(timeout=5)

# 2) Test exception (also guaranteed)
try:
    1 / 0
except Exception as e:
    sentry_sdk.capture_exception(e)
    sentry_sdk.flush(timeout=5)
    raise
