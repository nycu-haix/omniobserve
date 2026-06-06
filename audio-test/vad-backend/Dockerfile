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
RUN pip install --no-cache-dir -r requirements.cuda-v100.txt
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cu118 \
    torchaudio==2.4.1+cu118

COPY . .

EXPOSE 8000

CMD ["uvicorn", "server_gateway:app", "--host", "0.0.0.0", "--port", "8000"]
