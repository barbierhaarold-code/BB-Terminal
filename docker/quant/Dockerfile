# Quant microservice (port 6901). Internal network only; never published.
FROM python:3.12-slim
RUN useradd --create-home --uid 10001 quant
RUN pip install --no-cache-dir fastapi==0.136.3 uvicorn==0.40.0 pydantic==2.13.4 numpy==2.5.2 pandas==3.0.5 scipy==1.18.0 statsmodels==0.14.6
COPY quant_service/main.py /app/main.py
USER quant
WORKDIR /app
ENV QUANT_HOST=0.0.0.0 PYTHONUNBUFFERED=1
EXPOSE 6901
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:6901/health', timeout=4).status==200 else 1)"
CMD ["python", "/app/main.py"]
