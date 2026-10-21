# MemoryLane capture service: one image for both the API and the worker.
#
# Base: Playwright's Python image (Ubuntu 24.04 + the Chromium build that
# matches the pinned `playwright` package). Pinned by tag; keep it in step
# with requirements.txt's playwright version.
FROM denoland/deno:bin-2.6.3 AS deno

FROM mcr.microsoft.com/playwright/python:v1.63.0-noble

# ffmpeg: yt-dlp merges separate video+audio streams. tini: reaps Chromium's child processes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp needs a JavaScript runtime for YouTube's signature challenges.
COPY --from=deno /deno /usr/local/bin/deno

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    STORAGE_DIR=/data/store \
    WORK_DIR=/tmp/memlane-capture

# The replay viewer's files (replay.py): ReplayWeb.page by Webrecorder, AGPL-3.0, served unmodified on its own
# origin. Pinned by version and checksum; not kept in this repository.
ARG REPLAYWEBPAGE_VERSION=2.5.3
ARG REPLAYWEBPAGE_SHA256=b7d35c39c4da9b7121c5a393911d8675d4cc6f19513c380191e16b086bea812c
RUN python3 - <<EOF
import hashlib, io, tarfile, urllib.request
v, want = "${REPLAYWEBPAGE_VERSION}", "${REPLAYWEBPAGE_SHA256}"
data = urllib.request.urlopen(f"https://registry.npmjs.org/replaywebpage/-/replaywebpage-{v}.tgz", timeout=120).read()
assert hashlib.sha256(data).hexdigest() == want, "replaywebpage tarball checksum mismatch"
import os; os.makedirs("/opt/replaywebpage", exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(data)) as t:
    for name in ("ui.js", "sw.js", "LICENSE"):
        open(f"/opt/replaywebpage/{name}", "wb").write(t.extractfile(f"package/{name}").read())
EOF
ENV REPLAYWEBPAGE_VERSION=${REPLAYWEBPAGE_VERSION}

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY migrations ./migrations
COPY memlane_capture ./memlane_capture
COPY tests ./tests
COPY pytest.ini .

# Never run Chromium or yt-dlp as root on captured, hostile content.
RUN mkdir -p /data/store /data/feed /tmp/memlane-capture && chown -R pwuser:pwuser /data /tmp/memlane-capture
USER pwuser

ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "memlane_capture.worker"]
