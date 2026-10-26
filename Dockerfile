FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
FROM python:3-alpine
WORKDIR /app
COPY --from=build /app/dist ./
ENV PORT=80
EXPOSE 80
CMD python3 -m http.server "$PORT" --bind 0.0.0.0
