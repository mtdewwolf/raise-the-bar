# Build from the repository root:  docker build -f server/Dockerfile -t rtb-server .
# The server needs ../index.html: it verifies replays with the game's own simulation code.
FROM node:22-slim
WORKDIR /app
COPY index.html ./index.html
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
ENV PORT=8787 RTB_DB=/data/rtb.sqlite
VOLUME /data
EXPOSE 8787
# Railway-mounted volumes are root-owned; SQLite must be able to write /data.
CMD ["node", "--no-warnings", "server/server.js"]
