# Backend Job Tracker untuk Render / Railway / Fly.io / VPS.
# Chromium + library sistemnya di-install lewat Playwright supaya versinya selalu cocok
# dengan versi playwright di package.json.
FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Download Chromium + dependency sistem (libnss3, dst). Inilah yang hilang di error
# "browserType.launch: Executable doesn't exist".
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
