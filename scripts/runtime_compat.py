"""Small cross-platform runtime normalization shared by command-line scripts."""

import os
import sys


def configure_utf8_stdio() -> None:
    """Keep logs and JSON pipes UTF-8 even when Windows defaults to a legacy code page."""
    if os.name != "nt":
        return

    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


configure_utf8_stdio()
