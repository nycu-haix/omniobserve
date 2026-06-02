FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir whisperlivekit==0.2.20 python-multipart safetensors

EXPOSE 8000

ENTRYPOINT ["wlk", "--host", "0.0.0.0"]
CMD ["--backend", "whisper", "--model-path", "MediaTek-Research/Breeze-ASR-25", "--language", "zh", "--backend-policy", "simulstreaming", "--frame-threshold", "15", "--pcm-input"]
