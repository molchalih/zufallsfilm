FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY index.html tsconfig.json ./
RUN mkdir -p /data

# Last, so a new commit does not invalidate the install and copy layers above
# it. Defaulted rather than required: a local `docker build` is not a release
# and has no commit worth claiming. A runtime `APP_VERSION` still wins over it.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV DB_PATH=/data/picker.sqlite
ENV NODE_ENV=production
# 3000 is the public app. 9091 is the internal Prometheus endpoint — documented
# here, but intentionally never PublishPort'd: it is reached only through the
# mTLS metrics sidecar on the private container network. See
# docs/decisions/DR-005-internal-metrics-endpoint.md.
EXPOSE 3000 9091
CMD ["bun", "run", "src/index.ts"]
