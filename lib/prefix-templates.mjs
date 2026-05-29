export const PREFIX_TEMPLATES = {
  default: {
    index: '',
    query: '',
    description: 'No prefix (general purpose)',
    useCase: 'Any content type'
  },
  
  code: {
    index: 'code: ',
    query: 'search code: ',
    description: 'Source code repositories',
    useCase: 'PHP, JavaScript, Python, etc.'
  },
  
  docs: {
    index: 'passage: ',
    query: 'query: ',
    description: 'Technical documentation',
    useCase: 'Markdown docs, technical guides, wiki pages'
  },
  
  design: {
    index: 'document: ',
    query: 'find: ',
    description: 'Business documents, design docs, requirements',
    useCase: 'Design docs, specs, business documents, requirements'
  },
  
  bge: {
    index: 'Represent this sentence for retrieval: ',
    query: 'Represent this sentence for searching: ',
    description: 'BGE embedding models (recommended by model authors)',
    useCase: 'When using BGE-M3 or other BGE models'
  },
  
  instructor: {
    index: 'Represent the document for retrieval: ',
    query: 'Represent the question for retrieving supporting documents: ',
    description: 'Instructor embedding models',
    useCase: 'When using Instructor models'
  },
  
  rerank: {
    index: 'passage: ',
    query: 'rerank: ',
    description: 'Reranking models',
    useCase: 'When using reranking models like bge-reranker or cohere-rerank'
  }
};

// Aliases that resolve to core templates
export const TEMPLATE_ALIASES = {
  requirements: 'design',
  wiki: 'docs',
  chat: 'docs'
};

export function resolvePrefix(prefixConfig) {
  // No prefix configured
  if (!prefixConfig) {
    return { index: '', query: '' };
  }
  
  // String: must be template name or alias
  if (typeof prefixConfig === 'string') {
    // Check if it's an alias first
    const resolvedName = TEMPLATE_ALIASES[prefixConfig] || prefixConfig;
    
    if (PREFIX_TEMPLATES[resolvedName]) {
      const template = PREFIX_TEMPLATES[resolvedName];
      return { index: template.index, query: template.query };
    }
    // Unknown template - ERROR
    const available = [...Object.keys(PREFIX_TEMPLATES), ...Object.keys(TEMPLATE_ALIASES)].join(', ');
    throw new Error(
      `Unknown prefix template: "${prefixConfig}". ` +
      `Available templates: ${available}. ` +
      `Use custom prefix with object format: { "index": "...", "query": "..." }`
    );
  }
  
  // Object: custom prefix
  if (typeof prefixConfig === 'object' && !Array.isArray(prefixConfig)) {
    return {
      index: prefixConfig.index || '',
      query: prefixConfig.query || ''
    };
  }
  
  // Invalid type
  throw new Error(
    `Invalid prefix config. Must be string (template name) or object { "index": "...", "query": "..." }`
  );
}

export function suggestTemplate(files) {
  // Analyze file extensions and paths
  const extensions = files.map(f => f.split('.').pop().toLowerCase());
  const paths = files.map(f => f.toLowerCase());
  
  // Count file types
  const codeExts = ['php', 'js', 'mjs', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'ts', 'tsx'];
  const docExts = ['md', 'markdown', 'rst', 'txt'];
  
  const codeCount = extensions.filter(e => codeExts.includes(e)).length;
  const docCount = extensions.filter(e => docExts.includes(e)).length;
  
  // Check paths for hints
  const hasDesign = paths.some(p => p.includes('design') || p.includes('spec') || p.includes('requirement'));
  
  // Suggest based on analysis
  if (codeCount > docCount * 2) {
    return {
      template: 'code',
      reason: `Found ${codeCount} code files. The 'code' template is optimized for source code.`,
      confidence: 'high'
    };
  }
  
  if (hasDesign) {
    return {
      template: 'design',
      reason: `Found design/spec/requirements in paths. The 'design' template is optimized for business documents.`,
      confidence: 'high'
    };
  }
  
  if (docCount > 0) {
    return {
      template: 'docs',
      reason: `Found ${docCount} documentation files. The 'docs' template is optimized for technical documentation.`,
      confidence: 'medium'
    };
  }
  
  return {
    template: 'default',
    reason: `Could not determine content type. The 'default' template (no prefix) works for general content.`,
    confidence: 'low'
  };
}
