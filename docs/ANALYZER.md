# Prefix Effectiveness Analyzer

## Overview

Test different prefix templates against sample documents to find the most effective one based on actual retrieval accuracy.

## Quick Start

### CLI Usage

```bash
# Analyze a collection
node analyze-prefix.mjs config.json docs

# With custom sample size
node analyze-prefix.mjs config.json docs --sample-size 10

# With more queries per document
node analyze-prefix.mjs config.json docs --queries-per-doc 5
```

### MCP Usage

```javascript
{
  "tool": "analyze_prefix",
  "arguments": {
    "collection": "docs",
    "sample_size": 5,
    "queries_per_doc": 3
  }
}
```

## How It Works

### 1. Sample Selection

- Scans collection paths respecting exclusions
- **Excludes README.md files** (context, not content)
- Selects 5-10 representative documents:
  - Spread across file sizes (small, medium, large)
  - Spread across directories if possible

### 2. Query Generation

For each sample document:
- Extracts headers (`# Header`)
- Extracts bold lines (`**Bold text**`)
- Falls back to first sentences if needed
- Generates 3-5 queries per document

### 3. Parallel Testing

Tests 4 core templates simultaneously:
- `default` (no prefix)
- `code`
- `docs`
- `design`

Model-specific templates (`bge`, `instructor`) tested if that model is configured.

### 4. Accuracy Metrics

- **Recall@1**: Correct document ranks #1 (primary metric)
- **Recall@3**: Correct document in top 3
- **MRR**: Mean Reciprocal Rank
- **Avg Score**: Average cosine similarity

### 5. Recommendation

Shows best template with:
- Accuracy percentage
- Improvement vs no prefix
- Confidence level (High/Medium/Low)
- Ready-to-paste config

## Example Output

```
=== Prefix Effectiveness Analyzer ===

Collection: iit-docs
Paths: md/
Sample size: 5 documents
Queries per doc: 3

Scanning files...

Found 47 content files (3 README files excluded)

Selected 5 samples:

  1. md/protocols/testing.md (2.1 KB, md/protocols)
  2. md/billing/core-design.md (8.5 KB, md/billing)
  3. md/tax/overview.md (4.2 KB, md/tax)
  4. md/architecture/decisions.md (12.3 KB, md/architecture)
  5. md/guides/quickstart.md (1.8 KB, md/guides)

Generating queries...

Generated 15 queries total

Testing 4 templates in parallel...

=== Results ===

Tested: 5 documents, 15 queries

Accuracy (Recall@1):

  ✅ docs     → 91.0% (14/15 queries)
  ⚠️  design  → 85.0% (13/15)
  ⚠️  default → 78.0% (12/15)
  ❌ code     → 62.0% (9/15)

Recommendation: "docs" template
Improvement: +13.0% vs no prefix (78.0% → 91.0%)
Confidence: High

Config:

  "embedder": {
    "prefix": "docs"
  }
```

## Multi-Directory Detection

If different directories perform better with different prefixes:

```
⚠️  WARNING: Mixed content detected!

Different directories perform better with different prefixes:

  md/protocols/ → "design" (89% accuracy)
  md/guides/    → "docs" (93% accuracy)

RECOMMENDATION: Split into separate collections for +3% accuracy

Suggested config structure:
{
  "collections": {
    "collection-name-1": {
      "name": "qdrant-collection-name-1",
      "paths": ["md/protocols/"],
      "prefix": "design"
    },
    "collection-name-2": {
      "name": "qdrant-collection-name-2",
      "paths": ["md/guides/"],
      "prefix": "docs"
    }
  }
}

OR keep single collection (simpler, 88% accuracy):
{
  "collections": {
    "docs": {
      "name": "iit-docs",
      "paths": ["md/"],
      "prefix": "docs"
    }
  }
}
```

## Low Accuracy Warning

If best result < 75%:

```
⚠️  WARNING: Low accuracy detected!

Best result: 62.0% (below recommended threshold of 75%)

Possible causes:
  - Embedder not suitable for this content type
  - Sample documents too diverse
  - Consider testing different embedder
```

## Performance

- **Sample size**: 5 docs = ~2-3 seconds, 10 docs = ~4-5 seconds
- **Parallel testing**: 4 templates tested simultaneously
- **Total queries**: sample_size × queries_per_doc × 4 templates

Example: 5 docs × 3 queries × 4 templates = 60 embedding calls (~2-3 sec)

## Configuration Exclusions

The analyzer **respects config exclusions**:

```json
{
  "exclude": [
    "**/node_modules/**",
    "**/_litter/**",
    "**/logs/**"
  ]
}
```

Files matching exclusion patterns are never sampled.

## README.md Handling

README.md files are **excluded from testing** because they are:
- Meta-documentation (context about the project)
- Not representative of actual content
- Often contain links and references, not searchable content

Future enhancement: Parse README.md to identify important files to test.

## Template Consolidation

The analyzer tests **4 core templates**:
- `default` - No prefix
- `code` - Source code
- `docs` - Documentation (includes wiki, chat)
- `design` - Business docs (includes requirements)

Aliases (`requirements`, `wiki`, `chat`) resolve to core templates without adding test overhead.

## Best Practices

1. **Run before re-indexing** - Test prefixes on samples before full re-index
2. **Use realistic sample size** - 5-10 docs is usually sufficient
3. **Check confidence** - High confidence (>85%) means reliable recommendation
4. **Consider trade-offs** - Multi-collection split adds complexity for small accuracy gains
5. **Re-test after changes** - If content changes significantly, re-analyze

## Limitations

1. **Query quality** - Auto-generated queries may not match real user queries
2. **Sample bias** - Results depend on sample selection
3. **Embedder dependency** - Requires configured embedder to be running
4. **No cross-collection testing** - Tests one collection at a time

## Future Enhancements

- Parse README.md to identify important files
- LLM-generated queries (more realistic)
- Cross-embedder comparison
- Historical accuracy tracking
- A/B test reports (JSON output)
