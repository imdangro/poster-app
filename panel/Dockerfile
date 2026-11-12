# Panel sterowania Poster – czysty Node.js, bez zależności npm.
# ffmpeg: zamiana zdjęć WebP na JPG/PNG (X, Facebook i Telegram przyjmują tylko te formaty).
# Obraz bazowy można podmienić (np. przy limitach Docker Hub): --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
# ffmpeg jest wymagany – nieudana instalacja zatrzymuje budowę obrazu (3 próby na chwilowy błąd serwera pakietów
# Alpine), zamiast cicho zbudować panel, który pominie zdjęcia WebP
RUN for i in 1 2 3; do apk add --no-cache ffmpeg && exit 0; sleep 5; done; \
  echo 'Nie udało się zainstalować ffmpeg (apk) – sprawdź połączenie NAS-a z internetem i ponów aktualizację' >&2; exit 1
# Panel nie ma zależności npm – menedżery pakietów z obrazu Node.js są zbędne, a przejętemu procesowi ułatwiałyby
# pobranie i uruchomienie cudzego kodu
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
# Kod należy do roota i jest tylko do odczytu dla procesu panelu (USER node): przejęty proces nie podmieni programu.
COPY . .
RUN chmod -R u=rwX,go=rX /app
USER node
EXPOSE 7080 7081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7081/internal/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
