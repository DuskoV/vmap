# Embedding Prefix Instructions

## Overview

Prefix instructions improve embedding quality by providing context about the content type and search intent. Different prefixes are used for indexing (storing documents) vs querying (searching).

## Why Use Prefixes?

Many embedding models are trained with specific prefix instructions that:
- Improve retrieval accuracy (10-20% better results)
- Distinguish between document storage and query search
- Provide semantic context about content type

## Quick Start

### Using Templates (Recommended)

```json
{
  "embedder": {
    "prefix": "code"
  }
}
```

Available templates:
- `"default"` - No prefix (general purpose)
- `"code"` - Source code repositories
- `"docs"` - Technical documentation
- `"design"` - Business documents, design docs
- `"requirements"` - Requirements and specs (same as design)
- `"wiki"` - Wiki pages and knowledge base
- `"chat"` - Chat logs and conversations
- `"bge"` - BGE embedding models (recommended by authors)
- `"instructor"` - Instructor embedding models

### Custom Prefixes

```json
{
  "embedder": {
    "prefix": {
      "index": "passage: ",
      "query": "query: "
    }
  }
}
```

### No Prefix

Omit the `prefix` field entirely:

```json
{
  "embedder": {
    "provider": "lmstudio"
  }
}
```

## Template Details

### `code` Template
```
Index: "code: "
Query: "search code: "
```
**Use for:** PHP, JavaScript, Python, Java, etc.

**Example:**
- Index: `"code: function calculateTax(amount) { ... }"`
- Query: `"search code: tax calculation function"`

### `docs` Template
```
Index: "passage: "
Query: "query: "
```
**Use for:** Markdown documentation, README files, technical guides

**Example:**
- Index: `"passage: ## Installation\nRun npm install..."`
- Query: `"query: how to install the package"`

### `design` Template
```
Index: "document: "
Query: "find: "
```
**Use for:** Business documents, design docs, requirements, specifications

**Example:**
- Index: `"document: The billing system must support..."`
- Query: `"find: billing requirements"`

### `bge` Template
```
Index: "Represent this sentence for retrieval: "
Query: "Represent this sentence for searching: "
```
**Use for:** BGE-M3 and other BGE embedding models

**Recommended by model authors** for optimal performance.

### `instructor` Template
```
Index: "Represent the document for retrieval: "
Query: "Represent the question for retrieving supporting documents: "
```
**Use for:** Instructor embedding models

## Discovery Tools

### List All Templates

```bash
node prefix-templates.mjs
```

Output:
```
Available Prefix Templates:

  code            Source code repositories
                  Use case: PHP, JavaScript, Python, etc.
                  Index: "code: "
                  Query: "search code: "

  docs            Technical documentation
                  Use case: Markdown docs, README files
                  Index: "passage: "
                  Query: "query: "
  ...
```

### Get Suggestion (MCP Tool)

```javascript
// Via MCP
{
  "tool": "suggest_prefix_template",
  "arguments": {
    "collection": "code"
  }
}
```

Response:
```json
{
  "suggestion": "code",
  "confidence": "high",
  "reason": "Found 1234 code files. The 'code' template is optimized for source code.",
  "template": {
    "index": "code: ",
    "query": "search code: ",
    "description": "Source code repositories",
    "useCase": "PHP, JavaScript, Python, etc."
  },
  "usage": "Add to config.json:\n\"embedder\": {\n  \"prefix\": \"code\"\n}"
}
```

## Configuration Validation

### Valid Configurations

✅ **String (template name):**
```json
{ "prefix": "code" }
```

✅ **Object (custom):**
```json
{ "prefix": { "index": "doc: ", "query": "search: " } }
```

✅ **Omitted (no prefix):**
```json
{ "provider": "lmstudio" }
```

### Invalid Configurations

❌ **Unknown template:**
```json
{ "prefix": "invalid_name" }
```
**Error:** `Unknown prefix template: "invalid_name". Available templates: default, code, docs, ...`

❌ **Wrong type:**
```json
{ "prefix": ["array"] }
```
**Error:** `Invalid prefix config. Must be string (template name) or object { "index": "...", "query": "..." }`

## How It Works

### Indexing (mode='index')

When storing documents:
```javascript
const embedder = createEmbedder(config);
const embeddings = await embedder.embed(['function foo() {}'], 'index');
// Actual text sent: "code: function foo() {}"
```

### Querying (mode='query')

When searching:
```javascript
const embedder = createEmbedder(config);
const embeddings = await embedder.embed(['find tax function'], 'query');
// Actual text sent: "search code: find tax function"
```

### Automatic Mode Selection

- **Indexer:** Always uses `'index'` mode
- **Search:** Always uses `'query'` mode
- **Update:** Uses `'index'` mode

## Testing

Run prefix configuration tests:

```bash
node test-prefix-config.mjs
```

Tests:
1. String prefix (template name)
2. Object prefix (custom)
3. No prefix (default)
4. Invalid prefix template (should fail)

## Model-Specific Recommendations

### BGE-M3 (Recommended)
```json
{ "prefix": "bge" }
```

### Instructor Models
```json
{ "prefix": "instructor" }
```

### OpenAI text-embedding-3-*
```json
{ "prefix": "default" }
```
OpenAI models don't use prefix instructions.

### Nomic Embed
```json
{ "prefix": "docs" }
```
For documentation, or `"code"` for source code.

### Custom Models
Test with and without prefixes to see what works best. Start with `"default"` (no prefix).

## Migration Guide

### Existing Collections

If you add/change prefix configuration:

1. **Update config.json:**
   ```json
   {
     "embedder": {
       "prefix": "code"
     }
   }
   ```

2. **Re-index collection:**
   ```bash
   node indexer.mjs config.json <collection> --force
   ```

3. **Verify search quality:**
   ```bash
   node cli.mjs search <collection> "your test query"
   ```

### Backward Compatibility

Collections indexed without prefixes will continue to work. You can:
- Keep using them without prefixes
- Re-index with prefixes for better results

## Best Practices

1. **Use templates** - They're tested and optimized
2. **Match content type** - Use `"code"` for code, `"docs"` for docs
3. **Test before re-indexing** - Try different templates on small samples
4. **Re-index after changing** - Prefix changes require full re-index
5. **Document your choice** - Add comment in config explaining why

## Examples

### Multi-Collection Setup

```json
{
  "collections": {
    "code": {
      "name": "iit-code",
      "paths": ["www/"],
      "extensions": [".php"],
      "embedder": {
        "provider": "lmstudio",
        "prefix": "code"
      }
    },
    "docs": {
      "name": "iit-docs",
      "paths": ["md/"],
      "extensions": [".md"],
      "embedder": {
        "provider": "lmstudio",
        "prefix": "docs"
      }
    },
    "design": {
      "name": "iit-design",
      "paths": ["design/"],
      "extensions": [".md"],
      "embedder": {
        "provider": "lmstudio",
        "prefix": "design"
      }
    }
  }
}
```

### BGE-M3 Optimized

```json
{
  "embedder": {
    "provider": "lmstudio",
    "prefix": "bge",
    "lmstudio": {
      "url": "http://localhost:1234",
      "model": "bge-m3"
    }
  }
}
```

### Custom Prefixes for Domain-Specific Content

```json
{
  "embedder": {
    "prefix": {
      "index": "medical record: ",
      "query": "find medical record: "
    }
  }
}
```

## Troubleshooting

### Search Quality Decreased After Adding Prefix

- Try different template
- Verify model supports prefix instructions
- Re-index with `--force` flag
- Test with `"default"` (no prefix)

### Error: "Unknown prefix template"

- Check spelling: `"code"` not `"Code"`
- List available templates: `node prefix-templates.mjs`
- Use custom object format if template doesn't exist

### Prefix Not Applied

- Verify config.json syntax (valid JSON)
- Check embedder logs for prefix in text
- Ensure collection was re-indexed after config change

## References

- BGE model paper: https://arxiv.org/abs/2309.07597
- Instructor models: https://instructor-embedding.github.io/
- Embedding best practices: https://www.sbert.net/examples/applications/semantic-search/README.html
