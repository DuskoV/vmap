import fs from 'fs/promises';
import crypto from 'crypto';

export async function setupCollection(store, embedder, collectionName) {
  const sampleEmbedding = await embedder.embed(['test'], 'index');
  const vectorSize = sampleEmbedding[0].length;
  
  await store.ensureCollection(collectionName, vectorSize);
  
  return vectorSize;
}

export async function indexFile(file, collectionName, { embedder, chunker, store, logger, rateLimitConfig, concurrency = 1 }) {
  file = file.replace(/\\/g, '/');
  const content = await fs.readFile(file, 'utf8');
  const currentHash = crypto.createHash('sha256').update(content).digest('hex');
  
  const chunks = await chunker.splitText(content, file);
  
  if (chunks === null) {
    logger.warn(`Skipping ${file} - chunking failed`);
    return { skipped: true, file };
  }
  
  logger.debug(`Split ${file} into ${chunks.length} chunks`);
  
  const points = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (chunk, batchIndex) => {
      const chunkIndex = i + batchIndex;
      const embeddings = await embedder.embed([chunk.text], 'index');
      const pointId = crypto.createHash('md5').update(`${file}:${chunkIndex}`).digest('hex');
      
      return {
        id: pointId,
        vector: embeddings[0],
        payload: {
          file,
          chunkIndex,
          text: chunk.text,
          ...chunk.metadata
        }
      };
    });
    
    const batchPoints = await Promise.all(batchPromises);
    points.push(...batchPoints);
    
    const delayMs = rateLimitConfig?.delayMs || 0;
    if (delayMs > 0 && i + concurrency < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  await store.upsertPoints(collectionName, points);
  
  return { hash: currentHash, chunks: chunks.length };
}
