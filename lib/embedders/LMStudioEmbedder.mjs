import axios from 'axios';
import { EmbedderBase } from './EmbedderBase.mjs';

export class LMStudioEmbedder extends EmbedderBase {
  async _callProvider(texts, config) {
    const response = await axios.post(
      `${config.url}/v1/embeddings`,
      { model: config.model, input: texts },
      { timeout: config.timeout }
    );
    return response.data.data.map(item => item.embedding);
  }
}
