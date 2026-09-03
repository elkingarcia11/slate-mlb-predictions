# ── Build stage ────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

# Cloud Run injects PORT; default to 8080 locally
ENV PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .
COPY static/ static/

# ── Runtime ────────────────────────────────────────────────────────────────────
# Use gunicorn for production; Cloud Run expects the container to listen on $PORT
RUN pip install --no-cache-dir gunicorn

EXPOSE 8080

CMD exec gunicorn --bind "0.0.0.0:$PORT" --workers 2 --threads 4 app:app
