# onnxruntime (Quran speech-to-text) needs glibc, so this uses Debian rather
# than Home Assistant's Alpine base images.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# onnxruntime-node's install script only fetches optional CUDA libraries, and
# it ships CPU builds for every OS: keep just Linux's.
RUN npm ci --omit=dev --ignore-scripts \
  && rm -rf node_modules/onnxruntime-node/bin/napi-v*/darwin node_modules/onnxruntime-node/bin/napi-v*/win32 \
  && npm cache clean --force
COPY server server
COPY lib lib
COPY public public

# /data persists across restarts and updates: the certificate (so each phone
# only accepts the warning once), the speech model and the Quran text.
ENV NODE_ENV=production DATA_DIR=/data PORT=3001
CMD ["node", "server/index.js"]
