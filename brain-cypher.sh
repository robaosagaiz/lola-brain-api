#!/bin/bash
# Lola Brain — Cypher query wrapper
# Usage: brain-cypher.sh "MATCH (n) RETURN n LIMIT 5"
QUERY="$1"
curl -s -X POST http://localhost:3005/cypher \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$(echo "$QUERY" | sed 's/"/\\"/g')\"}"
