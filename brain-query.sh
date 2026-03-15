#!/bin/bash
# Lola Brain — Quick query wrapper
# Usage: brain-query.sh "sua pergunta aqui" [limit]
# Returns: semantic results + graph entities (JSON)

QUERY="$1"
LIMIT="${2:-5}"

if [ -z "$QUERY" ]; then
  echo '{"error":"usage: brain-query.sh \"query\" [limit]"}'
  exit 1
fi

curl -s -X POST http://localhost:3005/search \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$(echo "$QUERY" | sed 's/"/\\"/g')\",\"limit\":$LIMIT}"
