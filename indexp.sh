#!/bin/bash
# vmap continuous indexer
# Runs every 1 second, only re-indexes changed files

cd "$(dirname "$0")"

echo "🔄 Starting continuous indexer (every 1 second)"
echo "📝 Logs: /tmp/vmap-continuous.log"
echo "Press Ctrl+C to stop"
echo ""

while true; do
  echo "[$(date '+%H:%M:%S')] Re-indexing..."
  node indexer.mjs ../../www code >> /tmp/vmap-continuous.log 2>&1
  
  if [ $? -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] ✅ Complete"
  else
    echo "[$(date '+%H:%M:%S')] ❌ Failed (check log)"
  fi
  
  sleep 1
done
