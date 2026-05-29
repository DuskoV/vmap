#!/usr/bin/env node
/**
 * Test prefix configuration loading and validation
 * 
 * Usage:
 *   node test-prefix-config.mjs
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEmbedder } from './lib/embedder.mjs';
import { createLogger } from './lib/logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tests = [
  {
    name: 'String prefix (template name)',
    config: 'fixtures/config-string-prefix.json',
    expected: {
      index: 'code: ',
      query: 'search code: '
    },
    shouldFail: false
  },
  {
    name: 'Object prefix (custom)',
    config: 'fixtures/config-object-prefix.json',
    expected: {
      index: 'passage: ',
      query: 'query: '
    },
    shouldFail: false
  },
  {
    name: 'No prefix (default)',
    config: 'fixtures/config-no-prefix.json',
    expected: {
      index: '',
      query: ''
    },
    shouldFail: false
  },
  {
    name: 'Invalid prefix template',
    config: 'fixtures/config-invalid-prefix.json',
    expected: null,
    shouldFail: true,
    errorMatch: /Unknown prefix template/
  }
];

let passed = 0;
let failed = 0;

console.log('\n=== Prefix Configuration Tests ===\n');

for (const test of tests) {
  try {
    const configPath = path.join(__dirname, test.config);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const collectionConfig = config.collections.test;
    
    // Disable logging for tests
    config.logging.console = false;
    config.logging.file = false;
    const logger = createLogger(config);
    
    if (test.shouldFail) {
      // Should throw error
      try {
        const embedder = createEmbedder(collectionConfig, logger);
        console.log(`❌ ${test.name}`);
        console.log(`   Expected error but succeeded`);
        failed++;
      } catch (error) {
        if (test.errorMatch && !test.errorMatch.test(error.message)) {
          console.log(`❌ ${test.name}`);
          console.log(`   Wrong error: ${error.message}`);
          failed++;
        } else {
          console.log(`✅ ${test.name}`);
          console.log(`   Correctly threw error: ${error.message}`);
          passed++;
        }
      }
    } else {
      // Should succeed
      const embedder = createEmbedder(collectionConfig, logger);
      
      if (embedder.prefix.index === test.expected.index && 
          embedder.prefix.query === test.expected.query) {
        console.log(`✅ ${test.name}`);
        console.log(`   Index: "${embedder.prefix.index}"`);
        console.log(`   Query: "${embedder.prefix.query}"`);
        passed++;
      } else {
        console.log(`❌ ${test.name}`);
        console.log(`   Expected: index="${test.expected.index}", query="${test.expected.query}"`);
        console.log(`   Got: index="${embedder.prefix.index}", query="${embedder.prefix.query}"`);
        failed++;
      }
    }
    
    console.log();
  } catch (error) {
    console.log(`❌ ${test.name}`);
    console.log(`   Unexpected error: ${error.message}`);
    console.log();
    failed++;
  }
}

console.log(`=== Results: ${passed} passed, ${failed} failed ===\n`);

process.exit(failed > 0 ? 1 : 0);
