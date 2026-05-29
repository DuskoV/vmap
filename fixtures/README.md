# Test Fixtures

Unit tests for the markdown breadcrumb chunking system and prefix configuration.

## Running Tests

```bash
# Breadcrumb chunker tests
node test-chunker.mjs

# Prefix configuration tests
node test-prefix-config.mjs
```

## Markdown Test Fixtures

- `test-breadcrumb.md` - Complex document with headers and bold lines
- `test-simple.md` - Simple document structure
- `test-fallback.md` - Large section triggering paragraph fallback
- `test-formatting.md` - Markdown formatting cleanup
- `test-windows-crlf.md` - Windows line endings (CRLF)
- `test-quoted.md` - Quoted/code text preservation (large)
- `test-quoted-short.md` - Quoted/code text preservation (small)

## Config Test Fixtures

- `config-string-prefix.json` - Template name as string (`"code"`)
- `config-object-prefix.json` - Custom prefix object
- `config-no-prefix.json` - No prefix field (default)
- `config-invalid-prefix.json` - Invalid template name (should fail)

## Breadcrumb Test Coverage

1. **Header hierarchy** - Validates `::` separator for headers
2. **Bold line detection** - Validates `>>` separator for bold sub-sections
3. **Paragraph fallback** - Validates chunking strategy when section too large
4. **Separator validation** - Validates all three separator types (`>`, `::`, `>>`)
5. **Markdown cleanup** - Removes list markers, checkboxes, formatting
6. **Line ending normalization** - Handles Windows CRLF
7. **Quoted text preservation** - Preserves backticks, quotes in breadcrumbs

## Prefix Config Test Coverage

1. **String prefix** - Template name resolution
2. **Object prefix** - Custom index/query prefixes
3. **No prefix** - Default behavior (empty strings)
4. **Invalid prefix** - Error handling with helpful message

## Expected Behavior

### Separators
- `>` - File path navigation (folders)
- `::` - Document structure (headers)
- `>>` - Tight context (bold lines + paragraph fallback)

### Example Breadcrumb
```
Users > duskov > Projects > IIT > scripts > codecompass > fixtures > test-breadcrumb :: Tower User Authentication :: Access Restrictions :: Tower-Only Access >> Exception (Future)
```

## Adding New Tests

### Breadcrumb Tests

Add to `tests` array in `test-chunker.mjs`:

```javascript
{
  name: 'Test name',
  file: 'fixture-file.md',
  checks: [
    { type: 'contains', value: ':: Expected Header' },
    { type: 'strategy', value: 'paragraph' },
    { type: 'separator', value: ' >> ', description: 'sub-section' }
  ]
}
```

### Prefix Config Tests

Add to `tests` array in `test-prefix-config.mjs`:

```javascript
{
  name: 'Test name',
  config: 'fixtures/config-test.json',
  expected: {
    index: 'expected index prefix',
    query: 'expected query prefix'
  },
  shouldFail: false
}
```
