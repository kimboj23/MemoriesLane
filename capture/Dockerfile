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
