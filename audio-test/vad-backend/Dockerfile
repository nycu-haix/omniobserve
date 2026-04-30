# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.cuda-v100.txt ./requirements.cuda-v100.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.cuda-v100.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "server_gateway:app", "--host", "0.0.0.0", "--port", "8000"]
