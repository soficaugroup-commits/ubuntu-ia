# Worker Ubuntu IA — LibreOffice + scripts Claude Office
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PYTHONPATH=/app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    poppler-utils \
    pandoc \
    fonts-dejavu \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/office_worker/requirements.txt /app/backend/office_worker/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/office_worker/requirements.txt

COPY .agents/skills /app/.agents/skills
COPY backend/office_worker /app/backend/office_worker

CMD ["python", "-m", "office_worker.worker"]
