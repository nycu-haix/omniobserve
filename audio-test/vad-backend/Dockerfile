# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.gateway.txt ./requirements.gateway.txt
RUN pip install --no-cache-dir -r requirements.gateway.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "server_gateway:app", "--host", "0.0.0.0", "--port", "8000"]
