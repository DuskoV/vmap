#!/usr/bin/env node
/**
 * List available prefix templates
 * 
 * Usage:
 *   node prefix-templates.mjs
 */
import { PREFIX_TEMPLATES } from './lib/prefix-templates.mjs';

console.log('\nAvailable Prefix Templates:\n');

for (const [name, template] of Object.entries(PREFIX_TEMPLATES)) {
  console.log(`  ${name.padEnd(15)} ${template.description}`);
  console.log(`  ${' '.repeat(15)} Use case: ${template.useCase}`);
  if (template.index || template.query) {
    console.log(`  ${' '.repeat(15)} Index: "${template.index}"`);
    console.log(`  ${' '.repeat(15)} Query: "${template.query}"`);
  }
  console.log();
}

console.log('Usage in config.json:');
console.log('  "embedder": {');
console.log('    "prefix": "code"  // Use template name');
console.log('  }');
console.log('\nOr custom prefix:');
console.log('  "embedder": {');
console.log('    "prefix": {');
console.log('      "index": "passage: ",');
console.log('      "query": "query: "');
console.log('    }');
console.log('  }\n');
