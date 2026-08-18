# OddsHarvester sidecar — scrapes OddsPortal.com via Playwright.
#
# Build:
#   docker build -t oddsharvester -f docker/oddsharvester/Dockerfile .
#
# Run (live MLB):
#   docker run --rm -v ./data:/out oddsharvester \
#     live -s baseball -l usa-mlb -m moneyline,over_under \
#     --headless --preview-only -o /out/baseball_live.json

FROM mcr.microsoft.com/playwright/python:v1.57.0-noble

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Clone and install OddsHarvester from source
RUN git clone --depth 1 https://github.com/jordantete/OddsHarvester.git . && \
    uv sync --frozen

ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["python3", "-m", "oddsharvester"]
