import path from 'path';
export { VectorStoreBase } from './VectorStoreBase.mjs';

export async function createVectorStore(config, logger) {
  const provider = config.vectorStore?.provider || 'lancedb';

  if (provider === 'lancedb') {
    try {
      const { LanceDBManager } = await import('./LanceDBManager.mjs');
      return new LanceDBManager({ configRoot: config._configRoot, ...config.vectorStore?.lancedb }, logger);
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
        throw new Error('LanceDB selected but not installed. Run: npm install @lancedb/lancedb');
      }
      throw e;
    }
  }

  if (provider === 'qdrant') {
    try {
      const { QdrantManager } = await import('./QdrantManager.mjs');
      return new QdrantManager({ configRoot: config._configRoot, ...config.vectorStore?.qdrant }, logger);
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
        throw new Error('Qdrant selected but not installed. Run: npm install @qdrant/js-client-rest');
      }
      throw e;
    }
  }

  if (provider === 'custom') {
    const customPath = config.vectorStore?.customPath;
    if (!customPath) throw new Error('vectorStore.customPath is required when provider is "custom"');
    const { default: CustomStore } = await import(path.resolve(config._configRoot, customPath));
    return new CustomStore({ configRoot: config._configRoot, ...config.vectorStore?.custom }, logger);
  }

  throw new Error(`Unknown vector store provider: ${provider}. Use "lancedb", "qdrant", or "custom".`);
}
