FROM oven/bun:1 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/apps/listen/dist/listen /app/listen
RUN groupadd --system listen && \
    useradd --system --gid listen --no-create-home listen
RUN mkdir -p /app/data && chown -R listen:listen /app/data
ENV NODE_ENV=production
ENV LISTEN_PORT=8080
ENV LISTEN_HOST=0.0.0.0
ENV LISTEN_DATA_DIR=/app/data
EXPOSE 8080
USER listen
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${LISTEN_PORT}/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/listen", "serve"]
