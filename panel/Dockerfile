# Panel sterowania Poster – czysty Node.js, bez zależności npm.
# ffmpeg: zamiana zdjęć WebP na JPG/PNG (X, Facebook i Telegram przyjmują tylko te formaty).
# Obraz bazowy można podmienić (np. przy limitach Docker Hub): --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
# (błąd instalacji nie blokuje budowy panelu – wtedy zdjęcia WebP są pomijane)
RUN apk add --no-cache ffmpeg || echo 'UWAGA: nie udało się zainstalować ffmpeg – zdjęcia WebP będą pomijane'
WORKDIR /app
COPY --chown=node:node . .
USER node
EXPOSE 7080 7081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7081/internal/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
