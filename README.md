# vmap

vmap gives coding agents semantic memory over a local codebase.

It indexes code and docs into named vector collections, then exposes MCP tools for semantic search, targeted file updates, and full reindexing. Use it when literal search is too narrow: finding related implementation by intent, locating architecture notes by concept, or keeping an agent's view of a repo fresh after files move or change.

## Why Use vmap?

Literal search finds exact words. vmap finds relevant context.

Use vmap when you need to answer questions like:

- Where is the resume enrichment pipeline described?
- What code handles taxonomy lookup ranking?
- Which docs explain parser release validation?
- What changed file should be re-indexed after an edit?
- How do I remove stale search results after moving or deleting files?

vmap is especially useful for coding agents because it gives them repo-local semantic discovery without making them scan the whole tree.

## Highlights

- MCP-native semantic search for code and docs
- Per-directory `.vmap.yaml` config discovery
- Multiple named collections, such as `code` and `docs`
- File-level updates for changed files
- Missing-path updates delete stale vector records
- Full collection reindexing when needed
- LanceDB and Qdrant vector store support
- Local or API-backed embedding providers

## vmap vs rg

Use `rg` when you know the exact token, class name, route, or error string.

Use vmap when you know the idea but not the words: "release validation", "taxonomy lookup ranking", "resume parser enrichment", "queue locking", or "job posting workflow". A good agent workflow is to use vmap for semantic discovery first, then use `rg` and file reads to inspect exact implementation details.

## Typical Agent Workflow

Search before broad literal grep:

```json
{
  "collection": "docs",
  "path": "/path/to/repo/md",
  "query": "taxonomy release validation protocol"
}
```

After editing files, update only those paths:

```json
{
  "files": ["/path/to/repo/md/protocols/example.md"]
}
```

After moving a file, update both paths:

```json
{
  "files": [
    "/path/to/repo/md/old-location/example.md",
    "/path/to/repo/md/new-location/example.md"
  ]
}
```

The old missing path removes stale indexed chunks. The new path indexes the moved file.

## Quick Start

Install dependencies when needed:

```bash
cd scripts/vmap
npm install
```

Place `.vmap.yaml` at the root of the directory tree you want to index. vmap auto-discovers the config by walking up from any path passed to the CLI or MCP tools.

Index everything under a config root:

```bash
node indexer.mjs /path/to/repo all
```

Search through MCP:

```json
{
  "collection": "code",
  "path": "/path/to/repo",
  "query": "methods that normalize parsed resume skills",
  "limit": 5
}
```

Check status:

```bash
node cli.mjs /path/to/repo status
```

## Configuration

Minimal `.vmap.yaml`:

```yaml
embedder:
  provider: lmstudio
  lmstudio:
    url: http://localhost:1234
    model: nomic-embed-text-v2-moe
    concurrency: 20
    maxRetries: 3
    timeout: 30000

collections:
  code:
    description: "Source code files"
    extensions: [.php, .js]
    exclude:
      - "**/vendor/**"
      - "**/node_modules/**"
      - "**/dist/**"
    chunking:
      strategy: treesitter
      language: auto
      chunkSize: 4000
      chunkOverlap: 150
  docs:
    description: "Markdown documentation"
    extensions: [.md]
    exclude:
      - "**/fixtures/**"
      - "**/runtime/**"
    chunking:
      strategy: markdown-header
      maxChunkSize: 3000
      chunkOverlap: 0

vectorStore:
  provider: lancedb

logging:
  level: info
  console: true
  file: false
```

Collections inherit top-level `embedder`, `vectorStore`, and `logging`. Collection-level values replace the top-level value entirely.

## Indexing

```bash
cd scripts/vmap

# Index all configured collections
node indexer.mjs /path/to/repo all

# Index one collection
node indexer.mjs /path/to/repo code
node indexer.mjs /path/to/repo docs

# Force reindex, ignoring stored hashes
node indexer.mjs /path/to/repo all --force
```

The indexer uses delta sync. It stores content hashes, skips unchanged files, and removes indexed records for files that were deleted from disk.

## Targeted Updates And Deletes

Use targeted updates when you already know which files changed:

```bash
node updater.mjs /path/to/repo/www/models/Taxonomy.php
```

For deleted files, pass the old path even though it no longer exists:

```bash
node updater.mjs /path/to/repo/md/old-note.md
```

For moved files, pass both the old and new paths:

```bash
node updater.mjs /path/to/repo/md/old-note.md /path/to/repo/md/new-note.md
```

Existing paths are re-indexed. Missing paths delete stale chunks and hash metadata for that path.

## MCP Tools

- `vmap_search_collection` - Semantically search indexed content
- `vmap_update_collection` - Re-index existing files and delete records for missing file paths
- `vmap_get_collections` - List configured collections for a path
- `vmap_reindex_collection` - Re-index one collection or all collections under a path
- `vmap_list_prefix_templates` - List embedding prefix templates
- `vmap_suggest_prefix_template` - Suggest a prefix template for a path
- `vmap_analyze_prefix` - Compare prefix templates against sample documents

Example MCP server config:

```json
{
  "mcpServers": {
    "vmap": {
      "command": "node",
      "args": [
        "/Users/duskov/Projects/IIT/scripts/vmap/mcp-server.mjs",
        "/path/to/repo"
      ],
      "env": {}
    }
  }
}
```

The optional path argument preloads a config root. Tool calls can still discover other roots from their `path` or `files` arguments.

## Watcher

Keep indexes current automatically:

```bash
node watcher.mjs /path/to/repo
```

The watcher runs an initial index, watches configured file extensions, debounces rapid changes for five seconds, and reindexes the affected config root.

## CLI Commands

```bash
node cli.mjs /path/to/repo status
node cli.mjs /path/to/repo health
node cli.mjs /path/to/repo reset code
node cli.mjs /path/to/repo reset all
```

## Architecture

- Tree-sitter chunking for code
- Markdown-header chunking for docs
- SHA256 hash tracking for delta sync
- Per-file metadata records for stale-file cleanup
- LanceDB local storage under `.vmap/db` by default
- Optional Qdrant backend for server-backed vector storage
- Prefix templates for model-specific indexing and query text

## Requirements

- Node.js 18+
- An embedding provider, such as LM Studio, Ollama, OpenAI, or Voyage
- LanceDB local storage by default, or Qdrant if configured

## Troubleshooting

MCP not loading?

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.mjs /path/to/repo
```

Config not found?

- Place `.vmap.yaml` in the root of the tree you want to index.
- Pass a path inside that tree to CLI commands or MCP tool calls.
- Use `node cli.mjs /path/to/repo status` to confirm config discovery.

Search returns stale files?

- For known deleted paths, call `vmap_update_collection` or `node updater.mjs` with the missing old path.
- For broad cleanup, run `node indexer.mjs /path/to/repo all`.
