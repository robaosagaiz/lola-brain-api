FROM oven/bun:1.1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY src/ ./src/

ENV PORT=3005
ENV QDRANT_URL=http://qdrant:6333
ENV QDRANT_API_KEY=hawthorne-qdrant-2025
ENV NEO4J_URI=bolt://neo4j:7687
ENV NEO4J_USER=neo4j
ENV NEO4J_PASS=lobabrain2026
ENV OLLAMA_URL=http://ollama:11434

EXPOSE 3005

CMD ["bun", "run", "src/api.ts"]
