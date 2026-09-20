FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public

ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/index.js"]
