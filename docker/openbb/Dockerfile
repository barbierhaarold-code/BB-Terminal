# OpenBB Platform API (port 6900). Internal network only; never published.
# Build context = repo root.
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential patch && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
# Versions match the working local install (setup.sh installs unpinned "openbb[all]").
RUN pip install --no-cache-dir --upgrade pip wheel \
 && pip install --no-cache-dir "openbb[all]==4.7.2" "openbb-yfinance==1.6.3"
# Same local dependency patches setup.sh applies (fail the build if one no longer applies).
COPY patches/ /patches/
RUN SITE="$(python -c 'import openbb_yfinance,os;print(os.path.dirname(os.path.dirname(openbb_yfinance.__file__)))')" \
 && patch -p1 -d "$SITE" < /patches/openbb_yfinance-1.6.3-options-chains-retry.patch \
 && patch -p1 -d "$SITE" < /patches/openbb_nasdaq-economic-calendar-date-offset.patch

FROM python:3.12-slim
RUN useradd --create-home --uid 10001 openbb \
 && mkdir -p /home/openbb/OpenBBUserData /home/openbb/.openbb_platform \
 && chown -R openbb:openbb /home/openbb
COPY --from=build /opt/venv /opt/venv
COPY docker/openbb/entrypoint.py /app/entrypoint.py
ENV PATH=/opt/venv/bin:$PATH HOME=/home/openbb PYTHONUNBUFFERED=1
USER openbb
WORKDIR /app
# Build the extension cache once at image build so first boot is fast.
RUN python -c "import openbb; openbb.build()" || true
EXPOSE 6900
# start_period is generous: first start after a fresh volume builds caches.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:6900/openapi.json', timeout=8).status==200 else 1)"
CMD ["python", "/app/entrypoint.py", "--host", "0.0.0.0", "--port", "6900"]
