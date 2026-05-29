#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createChunker } from './lib/chunker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

const config = {
  chunking: {
    strategy: 'treesitter',
    language: 'markdown',
    chunkSize: 500,
    chunkOverlap: 50
  }
};

const logger = {
  warn: () => {},
  error: () => {},
  debug: () => {}
};

const tests = [
  {
    name: 'Header hierarchy with bold lines',
    file: 'test-breadcrumb.md',
    checks: [
      { type: 'contains', value: ':: Tower User Authentication' },
      { type: 'contains', value: ':: Overview' },
      { type: 'contains', value: ':: Access Restrictions' },
      { type: 'contains', value: ':: Tower-Only Access' },
      { type: 'contains', value: '>> Tower users are restricted to Tower routes only' },
      { type: 'contains', value: '>> Exception (Future)' },
      { type: 'contains', value: ':: Dual Session Scenario' }
    ]
  },
  {
    name: 'Simple document structure',
    file: 'test-simple.md',
    checks: [
      { type: 'contains', value: ':: Simple Document' },
      { type: 'contains', value: ':: Section One' },
      { type: 'contains', value: ':: Section Two' },
      { type: 'contains', value: ':: Subsection' }
    ]
  },
  {
    name: 'Paragraph fallback chunking',
    file: 'test-fallback.md',
    checks: [
      { type: 'strategy', value: 'paragraph' }
    ]
  },
  {
    name: 'Separator validation',
    file: 'test-breadcrumb.md',
    checks: [
      { type: 'separator', value: ' > ', description: 'path separator' },
      { type: 'separator', value: ' :: ', description: 'header separator' },
      { type: 'separator', value: ' >> ', description: 'sub-section separator' }
    ]
  },
  {
    name: 'Markdown formatting cleanup',
    file: 'test-formatting.md',
    checks: [
      { type: 'breadcrumb_clean', pattern: /^[^-\[\]✓✅❌`*]+$/, description: 'no markdown symbols in breadcrumb' }
    ]
  },
  {
    name: 'Windows CRLF line endings',
    file: 'test-windows-crlf.md',
    checks: [
      { type: 'contains', value: ':: Windows Line Endings' },
      { type: 'contains', value: ':: Section One' },
      { type: 'contains', value: ':: Section Two' },
      { type: 'strategy', value: 'paragraph' }
    ]
  },
  {
    name: 'Backtick code preservation',
    file: 'test-quoted.md',
    checks: [
      { type: 'breadcrumb_contains', value: '/employer/', description: 'backtick code preserved' }
    ]
  },
  {
    name: 'Double quote preservation',
    file: 'test-quoted.md',
    checks: [
      { type: 'breadcrumb_contains', value: 'This is', description: 'double quoted text preserved' }
    ]
  },
  {
    name: 'Single quote preservation',
    file: 'test-quoted.md',
    checks: [
      { type: 'breadcrumb_contains', value: 'Single quoted text', description: 'single quoted text preserved' }
    ]
  },
  {
    name: 'Short backtick preservation',
    file: 'test-quoted-short.md',
    checks: [
      { type: 'contains', value: ':: Backtick Test' }
    ]
  },
  {
    name: 'Short double quote preservation',
    file: 'test-quoted-short.md',
    checks: [
      { type: 'contains', value: ':: Double Quote Test' }
    ]
  },
  {
    name: 'Short single quote preservation',
    file: 'test-quoted-short.md',
    checks: [
      { type: 'contains', value: ':: Single Quote Test' }
    ]
  }
];

async function runTests() {
  console.log('\n=== BREADCRUMB CHUNKER TESTS ===\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log(`\nTest: ${test.name}`);
    console.log(`File: ${test.file}`);
    
    try {
      const filePath = path.join(fixturesDir, test.file);
      const content = await fs.readFile(filePath, 'utf8');
      
      const chunker = createChunker(config, logger);
      const chunks = await chunker.splitText(content, filePath);
      
      if (!chunks || chunks.length === 0) {
        console.log('❌ FAIL: No chunks generated');
        failed++;
        continue;
      }
      
      console.log(`Generated ${chunks.length} chunks`);
      
      let testPassed = true;
      
      for (const check of test.checks) {
        if (check.type === 'contains') {
          const found = chunks.some(c => c.metadata.breadcrumb?.full?.includes(check.value));
          if (found) {
            console.log(`  ✓ Found: "${check.value}"`);
          } else {
            console.log(`  ✗ Missing: "${check.value}"`);
            testPassed = false;
          }
        }
        
        if (check.type === 'strategy') {
          const found = chunks.some(c => c.metadata.chunkingStrategy === check.value);
          if (found) {
            console.log(`  ✓ Strategy: ${check.value}`);
          } else {
            console.log(`  ✗ Strategy not found: ${check.value}`);
            testPassed = false;
          }
        }
        
        if (check.type === 'separator') {
          const found = chunks.some(c => c.metadata.breadcrumb?.full?.includes(check.value));
          if (found) {
            console.log(`  ✓ Separator: "${check.value}" (${check.description})`);
          } else {
            console.log(`  ✗ Separator not found: "${check.value}" (${check.description})`);
            testPassed = false;
          }
        }
        
        if (check.type === 'breadcrumb_clean') {
          // Check that paragraph breadcrumbs are cleaned
          const paragraphChunks = chunks.filter(c => c.metadata.chunkingStrategy === 'paragraph');
          if (paragraphChunks.length > 0) {
            const allClean = paragraphChunks.every(c => {
              const subSections = c.metadata.breadcrumb?.subSections || [];
              const lastSubSection = subSections[subSections.length - 1] || '';
              return check.pattern.test(lastSubSection);
            });
            
            if (allClean) {
              console.log(`  ✓ ${check.description}`);
            } else {
              console.log(`  ✗ ${check.description}`);
              paragraphChunks.forEach(c => {
                const subSections = c.metadata.breadcrumb?.subSections || [];
                const lastSubSection = subSections[subSections.length - 1] || '';
                if (!check.pattern.test(lastSubSection)) {
                  console.log(`    Found: "${lastSubSection}"`);
                }
              });
              testPassed = false;
            }
          } else {
            console.log(`  ⚠ No paragraph chunks to test`);
          }
        }
        
        if (check.type === 'breadcrumb_contains') {
          // Check that breadcrumbs contain specific text (for quoted/code preservation)
          const found = chunks.some(c => {
            const breadcrumb = c.metadata.breadcrumb?.full || '';
            const subSections = c.metadata.breadcrumb?.subSections || [];
            return breadcrumb.includes(check.value) || subSections.some(s => s.includes(check.value));
          });
          
          if (found) {
            console.log(`  ✓ ${check.description}: "${check.value}"`);
          } else {
            console.log(`  ✗ ${check.description}: "${check.value}" not found`);
            testPassed = false;
          }
        }
      }
      
      if (testPassed) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        failed++;
      }
      
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}`);
      console.error(error.stack);
      failed++;
    }
  }
  
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}\n`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
