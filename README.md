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

### Required And Optional Config

Required:

- `embedder.provider`
- A matching provider block, such as `lmstudio`, `ollama`, `openai`, or `voyage`
- Provider connection fields, such as `url` and `model` for local providers, or `apiKey` and `model` for hosted providers
- `collections` with at least one collection key
- Each collection's `extensions`
- Each collection's `chunking.strategy`
- For `treesitter`, set `chunkSize` and `chunkOverlap`
- `logging` for CLI/indexer commands

Optional:

- `embedder.prefix` - template name such as `code`, `docs`, `design`, `bge`, or a custom `{ index, query }` object
- `description` - human-readable collection label
- `exclude` - glob patterns to skip generated or irrelevant files
- `vectorStore` - defaults to local LanceDB when omitted
- Provider tuning such as `concurrency`, `maxRetries`, `timeout`, and `rateLimit`
- `chunking.breadcrumb` - overrides Markdown breadcrumb formatting
- For `markdown-header`, `maxChunkSize` defaults to 3000 and `chunkOverlap` defaults to 0

## Config Examples

Docs-only `.vmap.yaml` with the markdown header chunker:

```yaml
embedder:
  provider: lmstudio
  prefix: docs
  lmstudio:
    url: http://localhost:1234
    model: nomic-embed-text-v2-moe
    concurrency: 20
    maxRetries: 3
    timeout: 30000

collections:
  docs:
    description: "Markdown documentation"
    extensions: [.md]
    exclude:
      - "**/node_modules/**"
      - "**/.vmap/**"
      - "**/runtime/**"
    chunking:
      strategy: markdown-header
      maxChunkSize: 3000
      chunkOverlap: 0
      breadcrumb:
        pathSeparator: " > "
        headerSeparator: " :: "
        subSectionSeparator: " >> "
        skipExtension: true
        includeBoldParagraphs: true

vectorStore:
  provider: lancedb
```

Code-only `.vmap.yaml` with Tree-sitter chunking:

```yaml
embedder:
  provider: lmstudio
  prefix: code
  lmstudio:
    url: http://localhost:1234
    model: nomic-embed-text-v2-moe
    concurrency: 10
    maxRetries: 3
    timeout: 30000

collections:
  code:
    description: "Application source"
    extensions: [.php, .js, .mjs]
    exclude:
      - "**/vendor/**"
      - "**/node_modules/**"
      - "**/dist/**"
      - "**/*.min.js"
    chunking:
      strategy: treesitter
      language: auto
      chunkSize: 4000
      chunkOverlap: 150

vectorStore:
  provider: lancedb
```

Qdrant-backed `.vmap.yaml`:

```yaml
embedder:
  provider: openai
  prefix: docs
  openai:
    apiKey: "REPLACE_WITH_OPENAI_API_KEY"
    model: text-embedding-3-small
    maxRetries: 3
    timeout: 30000

collections:
  docs:
    description: "Markdown documentation"
    extensions: [.md]
    chunking:
      strategy: markdown-header
      maxChunkSize: 3000
      chunkOverlap: 0

vectorStore:
  provider: qdrant
  qdrant:
    url: http://localhost:6333
```

vmap reads this value directly from `.vmap.yaml`; it does not expand shell environment variables in config files.

### Configurable Markdown Chunker

vmap includes a built-in configurable Markdown chunker. It is not a separate plugin; you customize it through the collection's `chunking` block.

For Markdown files, prefer:

```yaml
chunking:
  strategy: markdown-header
  maxChunkSize: 3000
  chunkOverlap: 0
  breadcrumb:
    pathSeparator: " > "
    headerSeparator: " :: "
    subSectionSeparator: " >> "
    skipExtension: true
    includeBoldParagraphs: true
```

The markdown header chunker splits documents by Markdown headings, keeps heading metadata, and adds a breadcrumb payload containing the file path and heading stack. When a heading section is larger than `maxChunkSize`, it splits that section by paragraphs. With `includeBoldParagraphs: true`, short whole-line bold paragraphs and first-line quoted/code labels can become sub-section breadcrumbs, which improves retrieval for dense notes and protocol files.

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
        "/Users/duskov/Projects/IIT/scripts/vmap/mcp-server.mjs"
      ],
      "env": {}
    }
  }
}
```

No repository path is passed to the MCP server. vmap resolves the relevant config root at tool-call time by walking up from the provided `path` or `files` argument until it finds `.vmap.yaml`.

## Keeping The Index Current

The preferred agent workflow is to put a rule in the repo's steering file, agent instructions, or a vmap-specific skill:

```md
After changing indexed files, call `vmap_update_collection` with the changed absolute file paths. For moved files, include both the old missing path and the new path.
```

Agents usually obey this kind of rule reliably, and targeted updates avoid extra reindex work.

The watcher is optional. Run it in a separate terminal only when you want a background process to keep the index current:

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

## Benchmarks

vmap includes benchmark fixtures under `benchmarks/`. They are meant for comparing embedding models, prefix templates, chunking strategies, and vector stores against the same sample documents and query set.

Run the default benchmark first to create the baseline results file:

```bash
cd scripts/vmap
node benchmark.mjs benchmarks
```

That writes:

```text
benchmarks/.vmap.results.yaml
```

To compare another model or config, create another config file next to the baseline, for example:

```text
benchmarks/.vmap_bge-m3.yaml
```

Point it at the baseline:

```yaml
benchmark:
  baseline: .vmap.results.yaml
  docs:
    sampleSize: 6
    prefixes: [default, docs, bge]
    queries:
      - "user authentication login flow"
      - "database schema tables and columns"
  code:
    sampleSize: 8
    prefixes: [default, code, bge]
    queries:
      - "database transaction with rollback"
      - "user authentication and password validation"
```

Then run the new config without a collection key:

```bash
node benchmark.mjs benchmarks/.vmap_bge-m3.yaml
```

Omitting the collection key is intentional. It benchmarks every configured collection in the file, so docs and code are measured together and the output includes the full comparison statistics. Only pass a collection key, such as `code`, when you are intentionally doing a narrow local experiment.

The benchmark runner writes a matching results file:

```text
benchmarks/.vmap_bge-m3.results.yaml
```

### Adding More Benchmarks

When adding a new benchmark comparison, include both the config and its results file:

- `benchmarks/.vmap_<name>.yaml`
- `benchmarks/.vmap_<name>.results.yaml`

Use the same fixture files, `sampleSize`, query lists, and collection keys as the baseline unless the benchmark is explicitly testing the query set itself. This keeps the analytics meaningful because the new run is compared against the existing baseline on the same inputs.

Treat the baseline and candidate benchmark as a paired comparison. If you change the benchmark corpus, sample sizes, queries, chunking strategy, or vector store, rerun the baseline and the new config back-to-back in the same environment before comparing results:

```bash
node benchmark.mjs benchmarks/.vmap.yaml
node benchmark.mjs benchmarks/.vmap_<name>.yaml
```

Keep the generated `machine`, `model`, `provider`, `chunker`, `store`, `top1`, `top3`, and timing fields in the results files. They are the evidence needed to understand whether a change is better, faster, or just different.

## Requirements

- Node.js 18+
- An embedding provider, such as LM Studio, Ollama, OpenAI, or Voyage
- LanceDB local storage by default, or Qdrant if configured

## Troubleshooting

MCP not loading?

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.mjs
```

Config not found?

- Place `.vmap.yaml` in the root of the tree you want to index.
- Pass a path inside that tree to CLI commands or MCP tool calls.
- Use `node cli.mjs /path/to/repo status` to confirm config discovery.

Search returns stale files?

- For known deleted paths, call `vmap_update_collection` or `node updater.mjs` with the missing old path.
- For broad cleanup, run `node indexer.mjs /path/to/repo all`.
