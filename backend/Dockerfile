FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
ARG INSTALL_LOCAL_REQUIREMENTS=0
RUN if [ "$INSTALL_LOCAL_REQUIREMENTS" = "1" ] && [ -f requirements.local.txt ]; then pip install --no-cache-dir -r requirements.local.txt; fi
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
