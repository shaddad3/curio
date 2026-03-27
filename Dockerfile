# -----------------------------------------------------------------------------
# Stage 1: Unified Python service (micromamba base with conda-forge geospatial stack)
# -----------------------------------------------------------------------------
FROM mambaorg/micromamba:1.4.0 AS runtime_base

# Ensure micromamba activation in non-interactive Docker builds
ENV MAMBA_DOCKERFILE_ACTIVATE=1
ENV PATH=/opt/conda/bin:$PATH
ENV PYTHONUNBUFFERED=1 LOG_TO_STDOUT=true

WORKDIR /app

# Make sure apt runs as root (some base images switch default user)
USER root

# keep small system deps (some packages like pillow/opencv may need these)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libsm6 libxext6 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python + geospatial stack from conda-forge (prebuilt ARM64 binaries)
# include pip so we can still pip-install requirements.txt afterwards
RUN micromamba install -n base -y -c conda-forge \
      python=3.10 gdal rasterio pyarrow pillow requests numpy duckdb pip && \
    micromamba clean --all --yes

# Copy source + any local tarballs the requirements may reference
COPY requirements.txt curio.py ./
COPY templates/ templates/
COPY docs/examples/ docs/examples/
COPY utk_curio/ utk_curio/
COPY utk_curio/sandbox/utk-0.8.9.tar.gz /app/utk_curio/sandbox/utk-0.8.9.tar.gz

# Install remaining Python requirements (pure-Python or pip-only extras)
RUN python -m pip install --no-cache-dir -r requirements.txt

# -----------------------------------------------------------------------------
# Stage 2: Build frontends with Node (avoids NodeSource on slim in CI)
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend_builder
WORKDIR /src
COPY utk_curio/frontend/ /src/utk_curio/frontend/

WORKDIR /src/utk_curio/frontend/utk-workflow/src/utk-ts
RUN npm install && npm run build

WORKDIR /src/utk_curio/frontend/urban-workflows
RUN npm install && npm run build

# -----------------------------------------------------------------------------
# Stage 3: Final image: Python runtime + built frontend assets
# -----------------------------------------------------------------------------
FROM runtime_base AS runtime

# Production mode: serve built frontend with Python http.server on 8080 (no Node/npm in image)
ENV CURIO_DEV=0

# Adjust these COPY paths if your build outputs to "build/" instead of "dist/"
COPY --from=frontend_builder /src/utk_curio/frontend/utk-workflow/src/utk-ts/dist \
    /app/utk_curio/frontend/utk-workflow/src/utk-ts/dist
COPY --from=frontend_builder /src/utk_curio/frontend/urban-workflows/dist \
    /app/utk_curio/frontend/urban-workflows/dist

# Expose necessary ports
EXPOSE 2000 5002 8080

# Dockerfile with Health Check
HEALTHCHECK --start-period=180s --interval=30s --timeout=60s --retries=20 CMD \
  curl -sf http://localhost:2000/health && \
  curl -sf http://localhost:5002/health && \
  curl -sf http://localhost:8080

CMD ["python", "curio.py", "start", "all", "--backend-host", "0.0.0.0", "--backend-port", "5002", "--sandbox-host", "0.0.0.0", "--sandbox-port", "2000"]
