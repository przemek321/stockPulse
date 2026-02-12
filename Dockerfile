FROM node:20-alpine

WORKDIR /app

# Kopiuj pliki zależności
COPY package.json package-lock.json ./

# Instaluj zależności
RUN npm ci

# Kopiuj kod źródłowy
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

# Buduj TypeScript
RUN npx tsc -p tsconfig.build.json

EXPOSE 3000

CMD ["node", "dist/main.js"]
