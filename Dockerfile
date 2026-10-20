FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    STUDIO_HOST=0.0.0.0 \
    STUDIO_PORT=4173

COPY --chown=node:node package.json server.js README.md THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data

RUN mkdir -p /app/.history && chown -R node:node /app

USER node

EXPOSE 4173

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
