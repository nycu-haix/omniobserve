FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface OMP_NUM_THREADS=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir faster-whisper==1.2.1
WORKDIR /app
COPY server.py index.html login.html ./
CMD ["python", "/app/server.py"]
