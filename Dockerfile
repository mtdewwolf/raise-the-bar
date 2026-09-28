# Railway detects a Dockerfile at the repository root. Build context must include
# both the game and the server, since replay verification loads index.html.
FROM node:22-slim
WORKDIR /app
COPY index.html ./index.html
COPY server ./server
ENV PORT=8787 RTB_DB=/data/rtb.sqlite
EXPOSE 8787
# Railway volumes are mounted as root; SQLite needs write access to /data.
CMD ["node", "--no-warnings", "server/server.js"]
