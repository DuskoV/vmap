# Prefix Templates - Quick Reference

## Template Cheat Sheet

| Template | Index Prefix | Query Prefix | Use For |
|----------|-------------|--------------|---------|
| `default` | _(none)_ | _(none)_ | General purpose |
| `code` | `code: ` | `search code: ` | PHP, JS, Python |
| `docs` | `passage: ` | `query: ` | Markdown docs |
| `design` | `document: ` | `find: ` | Business docs |
| `requirements` | `document: ` | `find: ` | Requirements |
| `wiki` | `article: ` | `search: ` | Wiki pages |
| `chat` | `message: ` | `find message: ` | Chat logs |
| `bge` | `Represent this sentence for retrieval: ` | `Represent this sentence for searching: ` | BGE models |
| `instructor` | `Represent the document for retrieval: ` | `Represent the question for retrieving supporting documents: ` | Instructor models |

## Config Examples

### Use Template
```json
{ "prefix": "code" }
```

### Custom Prefix
```json
{
  "prefix": {
    "index": "passage: ",
    "query": "query: "
  }
}
```

### No Prefix
```json
{ "provider": "lmstudio" }
```

## Commands

```bash
# List all templates
node prefix-templates.mjs

# Test config validation
node test-prefix-config.mjs
```

## MCP Tools

```javascript
// List templates
{ "tool": "list_prefix_templates" }

// Get suggestion
{ "tool": "suggest_prefix_template", "arguments": { "collection": "code" } }
```

## When to Use

- **Code repositories** → `"code"`
- **Technical docs** → `"docs"`
- **Business docs** → `"design"`
- **BGE-M3 model** → `"bge"`
- **Instructor model** → `"instructor"`
- **Mixed content** → `"default"`

## Migration

1. Add `"prefix": "template_name"` to config
2. Re-index: `node indexer.mjs config.json <collection> --force`
3. Test search quality

## Validation

✅ Valid: `"code"`, `"docs"`, `"design"`, etc.
❌ Invalid: `"Code"`, `"invalid"`, `123`

Error message shows available templates.
