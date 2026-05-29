#!/usr/bin/env node

import { readFileSync } from 'fs';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';

// Load config
const config = JSON.parse(readFileSync('./config.json', 'utf-8'));

// Get query from command line
const query = process.argv.slice(2).join(' ');

if (!query) {
  console.log('Usage: node query.mjs <search query>');
  console.log('Example: node query.mjs "methods that handle cascade updates"');
  process.exit(1);
}

console.log(`Searching: "${query}"\n`);

// Setup embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: 'dummy',
  configuration: {
    baseURL: config.embedder.url + '/v1',
  },
  modelName: config.embedder.model,
});

// Connect to Qdrant
const vectorStore = await QdrantVectorStore.fromExistingCollection(
  embeddings,
  {
    url: config.qdrant.url,
    collectionName: config.qdrant.collection,
  }
);

// Search
const results = await vectorStore.similaritySearchWithScore(query, 5);

console.log(`Found ${results.length} results:\n`);

results.forEach(([doc, score], i) => {
  console.log(`${i + 1}. Score: ${score.toFixed(3)}`);
  console.log(`   File: ${doc.metadata.source}`);
  console.log(`   Preview: ${doc.pageContent.substring(0, 200)}...`);
  console.log('');
});
