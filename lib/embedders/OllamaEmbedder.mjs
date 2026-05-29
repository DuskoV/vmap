import axios from 'axios';
import { EmbedderBase } from './EmbedderBase.mjs';

export class OllamaEmbedder extends EmbedderBase {
  async _callProvider(texts, config) {
    const response = await axios.post(
      `${config.url}/api/embeddings`,
      { model: config.model, prompt: texts[0] },
      { timeout: config.timeout }
    );
    return [response.data.embedding];
  }
}
