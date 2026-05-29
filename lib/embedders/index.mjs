import path from 'path';
export { EmbedderBase } from './EmbedderBase.mjs';
import { OllamaEmbedder } from './OllamaEmbedder.mjs';
import { LMStudioEmbedder } from './LMStudioEmbedder.mjs';
import { OpenAIEmbedder } from './OpenAIEmbedder.mjs';
import { VoyageEmbedder } from './VoyageEmbedder.mjs';

const PROVIDERS = {
  ollama:   OllamaEmbedder,
  lmstudio: LMStudioEmbedder,
  openai:   OpenAIEmbedder,
  voyage:   VoyageEmbedder,
};

export function createEmbedder(collectionConfig, logger) {
  const config = collectionConfig.embedder;
  const provider = config.provider;

  if (provider === 'custom') {
    throw new Error('Custom embedder provider requires async loading. Use createEmbedderAsync() instead.');
  }

  const EmbedderClass = PROVIDERS[provider];
  if (!EmbedderClass) throw new Error(`Unknown embedder provider: ${provider}. Available: ${Object.keys(PROVIDERS).join(', ')}, custom`);

  return new EmbedderClass(config, logger);
}

/**
 * Async variant — required for provider: custom.
 * Use this in new code; createEmbedder() is kept for backwards compatibility.
 *
 * Custom embedder config:
 *   embedder:
 *     provider: custom
 *     customPath: ./my-embedder.mjs   # resolved relative to configRoot
 *     custom:
 *       apiKey: ...
 */
export async function createEmbedderAsync(collectionConfig, logger) {
  const config = collectionConfig.embedder;

  if (config.provider !== 'custom') {
    return createEmbedder(collectionConfig, logger);
  }

  if (!config.customPath) throw new Error('embedder.customPath is required when provider is "custom"');
  const configRoot = collectionConfig._configRoot || collectionConfig.embedder._configRoot;
  const { default: CustomEmbedder } = await import(path.resolve(configRoot, config.customPath));
  return new CustomEmbedder(config, logger);
}
