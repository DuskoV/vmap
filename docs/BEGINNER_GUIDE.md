# CodeCompass 🧭 - Beginner's Guide

Complete step-by-step guide to set up semantic code search in Kiro.

---

## What is CodeCompass?

CodeCompass lets you search your code using natural language:
- "Find methods that handle taxonomy cascade updates"
- "Show me database configuration"
- "How does authentication work?"

It uses AI embeddings to understand meaning, not just keywords.

---

## Prerequisites

Before starting, make sure you have:
- ✅ Qdrant running on `localhost:6333`
- ✅ Voyage API key - Get free tier at https://www.voyageai.com/

---

## Step 1: Install Dependencies

```bash
cd scripts/codecompass
npm install
```

This installs the required packages (~3MB).

---

## Step 2: Check Your Config

Your config is at `.kiro/mcp/codecompass/config.json`

**Current setup:**
- **Collection:** `iit-code` (PHP + JavaScript files from `www/`)
- **Embedder:** Voyage API (fast, paid but cheap)
- **Chunking:** Tree-sitter AST-based (smart code structure)

```bash
# Quick check
cat ../../.kiro/mcp/codecompass/config.json
```

---

## Step 3: Test Connections

Make sure services are running:

```bash
# Test Qdrant
curl http://localhost:6333/collections

# Test Voyage API (replace with your key)
curl -H "Authorization: Bearer pa-YOUR-KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"voyage-code-2","input":["test"]}' \
  https://api.voyageai.com/v1/embeddings
```

Both should return JSON (not errors).

---

## Step 4: Index Your Code (First Time)

This creates searchable embeddings of your PHP and JavaScript files.

```bash
cd scripts/codecompass

# Index code (~3 minutes with 100ms rate limit)
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code
```

**What happens:**
1. Finds all `.php` and `.js` files in `www/` (~1,900 files)
2. Auto-detects language and splits by classes/functions using tree-sitter
3. Sends each chunk to Voyage API for embedding
4. Stores vectors in Qdrant
5. Waits 100ms between files (rate limit)

**Progress:**
- You'll see: `[INFO] Indexed /path/to/file.php (8 chunks)`
- Takes ~3 minutes for 1,900 files
- Creates ~20,000 searchable chunks

**If you get errors:**
- `400 Bad Request` - Chunk too large (should be fixed now)
- `429 Rate Limit` - Will retry automatically
- Just run again - it skips already-indexed files (delta sync)

---

## Step 6: Check Status

Verify everything indexed correctly:

```bash
node cli.mjs ../../.kiro/mcp/codecompass/config.json status
```

**You should see:**
```
DOCS (iit-docs):
  Points: 3273
  Vector Size: 4096

CODE (iit-code):
  Points: 15000+
  Vector Size: 1536
```

---

## Step 5: Configure Kiro

The MCP server is already configured in `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "codebase": {
      "command": "node",
      "args": ["/Users/duskov/Projects/IIT/scripts/codecompass/mcp-server.mjs"],
      "env": {}
    }
  }
}
```

**No changes needed!**

---

## Step 6: Start Kiro

Open a **new terminal** and start Kiro:

```bash
cd /Users/duskov/Projects/IIT
kiro-cli chat
```

**Look for this line:**
```
✓ codebase loaded
```

If you see it, CodeCompass is ready! ✅

---

## Step 7: Test Search in Kiro

Try these queries in your Kiro chat:

**Search code:**
```
Can you search the code for "authentication methods"?
```

```
Search for "database configuration"
```

```
Find "taxonomy cascade updates"
```

**Check status:**
```
What's the status of CodeCompass?
```

---

## Keeping Index Updated

### Option 1: Manual Re-Index (Simple)

When you make code changes, re-run the indexer:

```bash
cd scripts/codecompass

# Re-index (only changed files, ~30 seconds)
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code
```

Delta sync automatically skips unchanged files!

### Option 2: File Watcher (Advanced)

Auto-index when files change:

```bash
cd scripts/codecompass

# Watch for changes
node watcher.mjs ../../.kiro/mcp/codecompass/config.json iit-code
```

**What it does:**
1. Runs initial index to catch up
2. Watches for file changes
3. Auto-indexes changed files (5 second debounce)

**Run in background:**
```bash
node watcher.mjs ../../.kiro/mcp/codecompass/config.json iit-code &
```

### Force Full Re-Index

If something seems wrong, force re-index everything:

```bash
cd scripts/codecompass

# Force re-index all files
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code --force
```

# Re-index code (only changed files)
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code

# Force re-index everything (ignores delta sync)
node indexer.mjs ../../.kiro/mcp/codecompass/config.json all --force
```

### Delta Sync

Both watcher and manual indexing use delta sync:
- Tracks file hashes (SHA256)
- Only indexes changed files
- Skips unchanged files automatically
- Fast and efficient

---

## Step 10: Keep Index Updated (Optional)

### Option A: Run Watcher (Automatic)

Keep the watcher running to auto-update your index:

```bash
cd /Users/duskov/Projects/IIT/scripts/codecompass

# In a separate terminal or background
node watcher.mjs ../../.kiro/mcp/codecompass/config.json &
```

**Benefits:**
- Automatic updates when you edit files
- No manual re-indexing needed
- Search always reflects latest code

### Option B: Manual Re-Index (When Needed)

Just re-run the indexer when you make changes:

```bash
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-docs
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code
```

Delta sync makes this fast (only indexes changed files).

---

## Automatic File Watcher (Optional)

**Not implemented yet.** Currently you must manually re-index.

**To add auto-watch in the future:**
1. Create `watcher.mjs` that uses `chokidar`
2. Run it in background: `node watcher.mjs &`
3. It will auto-index when files change

**For now:** Just re-index manually when you make changes.

---

## Common Issues

### "Rate limit exceeded" (429 error)

**Cause:** Voyage free tier limit (10 requests/min)

**Solution:**
- Wait 1 minute and run again
- Or upgrade to paid Voyage ($15/month = 300 req/min)
- Or switch to local embedder (edit config)

### "Collection not found"

**Cause:** Haven't indexed yet

**Solution:**
```bash
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-docs
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code
```

### "MCP not connected" in Kiro

**Cause:** MCP server not starting

**Solution:**
```bash
# Test MCP manually
cd /Users/duskov/Projects/IIT/scripts/codecompass
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.mjs
```

Should return JSON with tools list.

### "No results found"

**Cause:** Collection is empty or query too specific

**Solution:**
- Check status: `node cli.mjs ../../.kiro/mcp/codecompass/config.json status`
- Try broader query: "taxonomy" instead of "taxonomy backfill cascade update protocol"

---

## Quick Reference

### Index Commands
```bash
cd /Users/duskov/Projects/IIT/scripts/codecompass

# Index docs
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-docs

# Index code
node indexer.mjs ../../.kiro/mcp/codecompass/config.json iit-code

# Index everything
node indexer.mjs ../../.kiro/mcp/codecompass/config.json all

# Force re-index
node indexer.mjs ../../.kiro/mcp/codecompass/config.json all --force
```

### Management Commands
```bash
# Check status
node cli.mjs ../../.kiro/mcp/codecompass/config.json status

# Check Qdrant health
node cli.mjs ../../.kiro/mcp/codecompass/config.json health

# Delete and recreate collection
node cli.mjs ../../.kiro/mcp/codecompass/config.json reset iit-code
```

### Watcher Commands
```bash
# Watch all collections (auto-index on changes)
node watcher.mjs ../../.kiro/mcp/codecompass/config.json

# Watch specific collection
node watcher.mjs ../../.kiro/mcp/codecompass/config.json iit-docs

# Watch multiple collections
node watcher.mjs ../../.kiro/mcp/codecompass/config.json iit-docs iit-code

# Run in background
node watcher.mjs ../../.kiro/mcp/codecompass/config.json &
```

### Kiro Usage
```
# In Kiro chat:
Search the docs for "X"
Search the code for "Y"
Search everything for "Z"
What's the status of CodeCompass?
```

---

## Cost Breakdown

### One-Time Indexing
- **Docs**: Free (LM Studio local)
- **Code**: ~$2 (Voyage API, 1,466 files)

### Ongoing Usage
- **Searches**: ~$0.0001 per search
- **Re-indexing**: Only changed files (~$0.10/week)

### Total
- **First month**: ~$2.50
- **After**: ~$0.50/month

---

## Next Steps

1. ✅ Index your docs and code (Steps 4-5)
2. ✅ Start Kiro and test search (Steps 8-9)
3. 🔄 Start watcher for auto-updates (Step 10) - Optional
4. 🚀 Enjoy semantic code search!

**Questions?** Check the main README or ask in Kiro chat.
