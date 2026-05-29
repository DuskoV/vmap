import Parser from 'tree-sitter';
import PHP from 'tree-sitter-php';
import Markdown from '@tree-sitter-grammars/tree-sitter-markdown';
import JavaScript from 'tree-sitter-javascript';

function slidingWindowChunk(text, chunkSize, overlap) {
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let currentLines = [];
  
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 <= chunkSize) {
      currentChunk += line + '\n';
      currentLines.push(line);
    } else {
      if (currentChunk) {
        chunks.push({ text: currentChunk.trim(), metadata: { type: 'text' } });
      }
      
      // Start new chunk with overlap
      const overlapLines = Math.floor(currentLines.length * (overlap / chunkSize));
      currentLines = currentLines.slice(-overlapLines);
      currentChunk = currentLines.join('\n') + (currentLines.length > 0 ? '\n' : '') + line + '\n';
      currentLines.push(line);
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), metadata: { type: 'text' } });
  }
  
  return chunks.length > 0 ? chunks : [{ text: text.substring(0, chunkSize), metadata: { type: 'text' } }];
}

function chunkJavaScript(code, chunkSize, overlap, logger) {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  
  try {
    const tree = parser.parse(code);
    const chunks = [];
    
    const topLevelNodes = tree.rootNode.children.filter(node => 
      ['function_declaration', 'class_declaration', 'export_statement', 'lexical_declaration', 'variable_declaration'].includes(node.type) ||
      (node.type === 'expression_statement' && node.text.length > 100)
    );
    
    if (topLevelNodes.length === 0) {
      logger?.warn('No JS declarations found, falling back to sliding window');
      return slidingWindowChunk(code, chunkSize, overlap);
    }
    
    let currentChunk = '';
    const metadata = { type: 'javascript' };
    
    for (const node of topLevelNodes) {
      const nodeText = code.slice(node.startIndex, node.endIndex);
      
      if (currentChunk.length + nodeText.length <= chunkSize) {
        currentChunk += nodeText + '\n';
      } else {
        if (currentChunk) {
          chunks.push({ text: currentChunk.trim(), metadata });
        }
        
        if (nodeText.length > chunkSize) {
          logger?.warn(`JS node exceeds chunk size (${nodeText.length} > ${chunkSize}), splitting with sliding window`);
          const subChunks = slidingWindowChunk(nodeText, chunkSize, overlap);
          chunks.push(...subChunks);
          currentChunk = '';
          continue;
        } else {
          currentChunk = nodeText + '\n';
        }
      }
    }
    
    if (currentChunk) {
      chunks.push({ text: currentChunk.trim(), metadata });
    }
    
    return chunks.length > 0 ? chunks : null;
  } catch (error) {
    logger?.error('JS parsing failed, skipping file', { error: error.message });
    return null;
  }
}

function extractJsMetadata(node, code) {
  const metadata = { type: node.type };
  
  if (node.type === 'class_declaration') {
    const nameNode = node.children.find(n => n.type === 'identifier');
    if (nameNode) {
      metadata.className = code.slice(nameNode.startIndex, nameNode.endIndex);
    }
  }
  
  if (node.type === 'function_declaration') {
    const nameNode = node.children.find(n => n.type === 'identifier');
    if (nameNode) {
      metadata.functionName = code.slice(nameNode.startIndex, nameNode.endIndex);
    }
  }
  
  return metadata;
}

function splitJsClass(classNode, code, chunkSize, overlap) {
  const chunks = [];
  const methods = classNode.children.filter(n => n.type === 'method_definition');
  
  if (methods.length === 0) {
    logger?.warn('JS class has no methods, skipping class');
    return [];
  }
  
  const classHeader = code.slice(classNode.startIndex, methods[0].startIndex);
  const classFooter = '\n}';
  
  let currentChunk = classHeader;
  
  for (const method of methods) {
    const methodText = code.slice(method.startIndex, method.endIndex);
    
    if (methodText.length > chunkSize) {
      if (currentChunk !== classHeader) {
        chunks.push(currentChunk + classFooter);
        currentChunk = classHeader;
      }
      
      const methodChunks = splitLargeNode(method, code, chunkSize, overlap);
      for (const chunk of methodChunks) {
        chunks.push(classHeader + chunk + classFooter);
      }
    } else if (currentChunk.length + methodText.length <= chunkSize) {
      currentChunk += methodText + '\n';
    } else {
      chunks.push(currentChunk + classFooter);
      currentChunk = classHeader + methodText + '\n';
    }
  }
  
  if (currentChunk !== classHeader) {
    chunks.push(currentChunk + classFooter);
  }
  
  return chunks;
}

function chunkPhp(code, chunkSize, overlap, logger, filePath) {
  const parser = new Parser();
  parser.setLanguage(PHP.php);
  
  try {
    const tree = parser.parse(code);
    const chunks = [];
    
    const topLevelNodes = tree.rootNode.children.filter(node => 
      ['class_declaration', 'function_definition'].includes(node.type)
    );
    
    if (topLevelNodes.length === 0) {
      logger?.warn(`No PHP declarations found in ${filePath || 'unknown file'}, falling back to sliding window`);
      return slidingWindowChunk(code, chunkSize, overlap);
    }
    
    for (const node of topLevelNodes) {
      const nodeText = code.slice(node.startIndex, node.endIndex);
      const metadata = extractPhpMetadata(node, code);
      
      if (nodeText.length <= chunkSize) {
        chunks.push({ text: nodeText, metadata });
      } else if (node.type === 'class_declaration') {
        const classChunks = splitClass(node, code, chunkSize, overlap);
        chunks.push(...classChunks.map(c => ({ text: c, metadata })));
      } else {
        const nodeChunks = splitLargeNode(node, code, chunkSize, overlap);
        chunks.push(...nodeChunks.map(c => ({ text: c, metadata })));
      }
    }
    
    return addOverlap(chunks, overlap);
  } catch (error) {
    logger?.error(`PHP parsing failed: ${filePath || 'unknown file'}, falling back to sliding window`);
    return slidingWindowChunk(code, chunkSize, overlap);
  }
}

function extractPhpMetadata(node, code) {
  const metadata = { type: node.type };
  
  if (node.type === 'class_declaration') {
    const nameNode = node.children.find(n => n.type === 'name');
    if (nameNode) {
      metadata.className = code.slice(nameNode.startIndex, nameNode.endIndex);
    }
  }
  
  if (node.type === 'method_declaration' || node.type === 'function_definition') {
    const nameNode = node.children.find(n => n.type === 'name');
    if (nameNode) {
      metadata.methodName = code.slice(nameNode.startIndex, nameNode.endIndex);
    }
  }
  
  return metadata;
}

function splitClass(classNode, code, chunkSize, overlap) {
  const chunks = [];
  const methods = classNode.children.filter(n => n.type === 'method_declaration');
  
  if (methods.length === 0) {
    logger?.warn('PHP class has no methods, skipping class');
    return [];
  }
  
  const classHeader = code.slice(classNode.startIndex, methods[0].startIndex);
  const classFooter = '\n}';
  
  let currentChunk = classHeader;
  
  for (const method of methods) {
    const methodText = code.slice(method.startIndex, method.endIndex);
    
    if (methodText.length > chunkSize) {
      if (currentChunk !== classHeader) {
        chunks.push(currentChunk + classFooter);
        currentChunk = classHeader;
      }
      
      const methodChunks = splitLargeNode(method, code, chunkSize, overlap);
      for (const chunk of methodChunks) {
        chunks.push(classHeader + chunk + classFooter);
      }
    } else if (currentChunk.length + methodText.length <= chunkSize) {
      currentChunk += methodText + '\n';
    } else {
      chunks.push(currentChunk + classFooter);
      currentChunk = classHeader + methodText + '\n';
    }
  }
  
  if (currentChunk !== classHeader) {
    chunks.push(currentChunk + classFooter);
  }
  
  return chunks;
}

function splitLargeNode(node, code, chunkSize, overlap) {
  const nodeText = code.slice(node.startIndex, node.endIndex);
  const statements = node.children.filter(n => 
    ['if_statement', 'for_statement', 'while_statement', 'expression_statement', 'return_statement'].includes(n.type)
  );
  
  if (statements.length > 1) {
    const chunks = [];
    const signature = code.slice(node.startIndex, statements[0].startIndex);
    let current = signature;
    
    for (const stmt of statements) {
      const stmtText = code.slice(stmt.startIndex, stmt.endIndex);
      
      if (current.length + stmtText.length <= chunkSize) {
        current += stmtText + '\n';
      } else {
        if (current) chunks.push(current + '\n}');
        current = signature + stmtText + '\n';
      }
    }
    
    if (current) chunks.push(current + '\n}');
    return chunks;
  }
  
  // Node too large and can't split by statements - skip it
  return [];
}

function chunkMarkdown(text, chunkSize, overlap, logger, filePath, breadcrumbConfig) {
  const parser = new Parser();
  parser.setLanguage(Markdown);
  
  try {
    const tree = parser.parse(text);
    const chunks = [];
    const sections = extractSections(tree.rootNode, text, filePath, breadcrumbConfig);
    
    if (sections.length === 0) {
      logger?.warn('No Markdown sections found, skipping file');
      return null;
    }
    
    for (const section of sections) {
      if (section.text.length <= chunkSize) {
        chunks.push({ 
          text: section.text, 
          metadata: { 
            header: section.header, 
            level: section.level,
            breadcrumb: section.breadcrumb
          } 
        });
      } else {
        // Fallback: split by double line breaks (paragraphs)
        // Normalize line endings for cross-platform compatibility
        const normalizedText = section.text.replace(/\r\n/g, '\n');
        const paragraphs = normalizedText.split(/\n\n+/);
        let current = section.header + '\n\n';
        let paraIndex = 0;
        
        for (const para of paragraphs) {
          if (current.length + para.length <= chunkSize) {
            current += para + '\n\n';
          } else {
            if (current !== section.header + '\n\n') {
              const breadcrumb = buildParagraphBreadcrumb(section.breadcrumb, current, section.header);
              chunks.push({ 
                text: current.trim(), 
                metadata: { 
                  header: section.header, 
                  level: section.level,
                  breadcrumb: breadcrumb,
                  chunkingStrategy: 'paragraph'
                } 
              });
            }
            current = section.header + '\n\n' + para + '\n\n';
            paraIndex++;
          }
        }
        
        if (current !== section.header + '\n\n') {
          const breadcrumb = buildParagraphBreadcrumb(section.breadcrumb, current, section.header);
          chunks.push({ 
            text: current.trim(), 
            metadata: { 
              header: section.header, 
              level: section.level,
              breadcrumb: breadcrumb,
              chunkingStrategy: 'paragraph'
            } 
          });
        }
      }
    }
    
    return addOverlap(chunks, overlap);
  } catch (error) {
    logger?.error('Markdown parsing failed, skipping file', { error: error.message });
    return null;
  }
}

function extractSections(node, text, filePath, breadcrumbConfig) {
  const sections = [];
  const headerStack = [];  // Track parent headers and bold lines
  let currentSection = null;
  
  function walk(n) {
    // Header detection
    if (n.type === 'atx_heading' || n.type === 'setext_heading') {
      // Save previous section
      if (currentSection) {
        currentSection.text = text.slice(currentSection.startIndex, currentSection.endIndex);
        currentSection.breadcrumb = buildBreadcrumb(filePath, headerStack, breadcrumbConfig);
        sections.push(currentSection);
      }
      
      // Extract header info
      const level = getHeaderLevel(n, text);
      const headerText = cleanHeaderText(text.slice(n.startIndex, n.endIndex));
      
      // Update header stack (pop headers at same/deeper level)
      while (headerStack.length > 0 && headerStack[headerStack.length - 1].level >= level) {
        headerStack.pop();
      }
      headerStack.push({ text: headerText, level, type: 'header' });
      
      // Start new section
      currentSection = {
        header: text.slice(n.startIndex, n.endIndex),
        level,
        startIndex: n.startIndex,
        endIndex: n.endIndex,
        headerStack: [...headerStack]
      };
    }
    // Bold line detection (whole line is bold)
    else if (breadcrumbConfig.includeBoldParagraphs && n.type === 'paragraph') {
      const boldLine = detectBoldLine(n, text);
      const quotedLine = detectQuotedLine(n, text);
      
      if (boldLine) {
        // Save previous section
        if (currentSection) {
          currentSection.text = text.slice(currentSection.startIndex, currentSection.endIndex);
          currentSection.breadcrumb = buildBreadcrumb(filePath, headerStack, breadcrumbConfig);
          sections.push(currentSection);
        }
        
        // Add bold line to stack
        const boldText = cleanBoldText(boldLine);
        headerStack.push({ text: boldText, level: 999, type: 'bold' });
        
        // Start new section
        currentSection = {
          header: currentSection ? currentSection.header : '',
          level: currentSection ? currentSection.level : 0,
          startIndex: n.startIndex,
          endIndex: n.endIndex,
          headerStack: [...headerStack]
        };
      } else if (quotedLine) {
        // Save previous section
        if (currentSection) {
          currentSection.text = text.slice(currentSection.startIndex, currentSection.endIndex);
          currentSection.breadcrumb = buildBreadcrumb(filePath, headerStack, breadcrumbConfig);
          sections.push(currentSection);
        }
        
        // Add quoted line to stack
        headerStack.push({ text: quotedLine, level: 999, type: 'quoted' });
        
        // Start new section
        currentSection = {
          header: currentSection ? currentSection.header : '',
          level: currentSection ? currentSection.level : 0,
          startIndex: n.startIndex,
          endIndex: n.endIndex,
          headerStack: [...headerStack]
        };
      } else if (currentSection) {
        currentSection.endIndex = n.endIndex;
      }
    }
    // Other nodes - extend current section
    else if (currentSection) {
      currentSection.endIndex = n.endIndex;
    }
    
    // Recurse
    for (const child of n.children) {
      walk(child);
    }
  }
  
  walk(node);
  
  // Save final section
  if (currentSection) {
    currentSection.text = text.slice(currentSection.startIndex, currentSection.endIndex);
    currentSection.breadcrumb = buildBreadcrumb(filePath, headerStack, breadcrumbConfig);
    sections.push(currentSection);
  }
  
  return sections;
}

function addOverlap(chunks, overlap) {
  if (chunks.length <= 1 || overlap === 0) return chunks;
  
  const result = [chunks[0]];
  
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const overlapText = prev.text.slice(-Math.min(overlap, prev.text.length));
    result.push({
      text: overlapText + '\n' + chunks[i].text,
      metadata: chunks[i].metadata
    });
  }
  
  return result;
}

function getHeaderLevel(node, text) {
  if (node.type === 'setext_heading') return 1;
  
  // Count # markers for atx_heading
  const headerText = text.slice(node.startIndex, node.endIndex);
  const match = headerText.match(/^#+/);
  return match ? match[0].length : 1;
}

function cleanHeaderText(text) {
  // Remove # markers and trim
  return text.replace(/^#+\s*/, '').replace(/\s*#+$/, '').trim();
}

function detectBoldLine(paragraphNode, text) {
  // Check if entire paragraph is wrapped in **...**
  const paraText = text.slice(paragraphNode.startIndex, paragraphNode.endIndex).trim();
  
  // Must start with ** and end with **
  if (!paraText.startsWith('**') || !paraText.endsWith('**')) return null;
  
  // Must be a single line (no line breaks inside)
  if (paraText.includes('\n')) return null;
  
  // Extract the bold text
  const boldText = paraText.slice(2, -2).trim();
  
  // Must not be empty
  if (!boldText) return null;
  
  // Must be relatively short (not a long paragraph)
  if (boldText.length > 100) return null;
  
  return boldText;
}

function cleanBoldText(text) {
  // Remove ** markers and trailing colon if present
  return text.replace(/\*\*/g, '').replace(/:$/, '').trim();
}

function detectQuotedLine(paragraphNode, text) {
  // Extract first line of paragraph
  const paraText = text.slice(paragraphNode.startIndex, paragraphNode.endIndex).trim();
  const firstLine = paraText.split('\n')[0].trim();
  
  // Check for backtick code: `text`
  const codeMatch = firstLine.match(/^`([^`]+)`/);
  if (codeMatch) {
    return codeMatch[1];
  }
  
  // Check for double quotes: "text"
  const doubleQuoteMatch = firstLine.match(/^"([^"]+)"/);
  if (doubleQuoteMatch) {
    return doubleQuoteMatch[1];
  }
  
  // Check for single quotes: 'text'
  const singleQuoteMatch = firstLine.match(/^'([^']+)'/);
  if (singleQuoteMatch) {
    return singleQuoteMatch[1];
  }
  
  return null;
}

function buildBreadcrumb(filePath, headerStack, config) {
  if (!filePath) return null;
  
  // Extract file path parts (relative to project root)
  const pathParts = filePath.split('/').filter(p => p);
  
  // Remove extension from last part if configured
  if (config.skipExtension && pathParts.length > 0) {
    const lastPart = pathParts[pathParts.length - 1];
    pathParts[pathParts.length - 1] = lastPart.replace(/\.[^.]+$/, '');
  }
  
  // Build file path breadcrumb
  const fileBreadcrumb = pathParts.join(config.pathSeparator);
  
  // Extract headers and sub-sections
  const headers = [];
  const subSections = [];
  
  for (const item of headerStack) {
    if (item.type === 'header') {
      headers.push(item.text);
    } else if (item.type === 'bold' || item.type === 'quoted') {
      subSections.push(item.text);
    }
  }
  
  // Build full breadcrumb
  let full = fileBreadcrumb;
  
  if (headers.length > 0) {
    full += config.headerSeparator + headers.join(config.headerSeparator);
  }
  
  if (subSections.length > 0) {
    full += config.subSectionSeparator + subSections.join(config.subSectionSeparator);
  }
  
  return {
    file: filePath,
    fileParts: pathParts,
    headers: headers,
    subSections: subSections,
    full: full,
    depth: headers.length + subSections.length
  };
}

function buildParagraphBreadcrumb(sectionBreadcrumb, chunkText, sectionHeader) {
  if (!sectionBreadcrumb) return null;
  
  // Extract first 5 words from chunk (excluding header)
  const contentText = chunkText.replace(sectionHeader, '').trim();
  
  // Normalize line endings for cross-platform compatibility
  const normalized = contentText.replace(/\r\n/g, '\n');
  
  // Extract first line or quoted/code content
  const firstLine = normalized.split('\n')[0].trim();
  
  // Check if line starts with quote or code
  let preview = '';
  
  // Backtick code: `text`
  const codeMatch = firstLine.match(/`([^`]+)`/);
  if (codeMatch) {
    preview = codeMatch[1];
  }
  // Double quotes: "text"
  else if (firstLine.startsWith('"')) {
    const quoteMatch = firstLine.match(/"([^"]+)"/);
    if (quoteMatch) {
      preview = quoteMatch[1];
    }
  }
  // Single quotes: 'text'
  else if (firstLine.startsWith("'")) {
    const quoteMatch = firstLine.match(/'([^']+)'/);
    if (quoteMatch) {
      preview = quoteMatch[1];
    }
  }
  
  // If no quoted/code content, clean markdown and take first 5 words
  if (!preview) {
    const cleaned = normalized
      .replace(/^[\s-]*[-*+]\s+/gm, '')      // Remove list markers (-, *, +)
      .replace(/^[\s]*\[[ xX]\]\s+/gm, '')   // Remove checkboxes [ ], [x], [X]
      .replace(/^[\s]*[✓✅❌]\s+/gm, '')      // Remove emoji checkmarks
      .replace(/`([^`]+)`/g, '$1')           // Remove inline code backticks
      .replace(/\*\*([^*]+)\*\*/g, '$1')     // Remove bold **text**
      .replace(/\*([^*]+)\*/g, '$1')         // Remove italic *text*
      .replace(/^[\s]+/gm, '')               // Remove leading whitespace
      .trim();
    
    const words = cleaned.split(/\s+/).slice(0, 5);
    preview = words.join(' ');
  }
  
  // Append to existing breadcrumb
  const config = {
    subSectionSeparator: ' >> '
  };
  
  return {
    ...sectionBreadcrumb,
    subSections: [...sectionBreadcrumb.subSections, preview],
    full: sectionBreadcrumb.full + config.subSectionSeparator + preview,
    depth: sectionBreadcrumb.depth + 1
  };
}

function splitBySize(text, size, overlap) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  
  for (const line of lines) {
    if (current.length + line.length + 1 <= size) {
      current += (current ? '\n' : '') + line;
    } else {
      if (current) chunks.push(current);
      current = line;
    }
  }
  
  if (current) chunks.push(current);
  
  return chunks.map(text => ({ text, metadata: {} }));
}

export function createChunker(collectionConfig, logger) {
  const { strategy, chunkSize, chunkOverlap, minChunkSize, maxChunkSize } = collectionConfig.chunking;
  
  // Default breadcrumb config (hardcoded, can be overridden)
  const defaultBreadcrumbConfig = {
    enabled: true,
    pathSeparator: ' > ',
    headerSeparator: ' :: ',
    subSectionSeparator: ' >> ',
    skipExtension: true,
    includeBoldParagraphs: true,
    maxDepth: 6
  };
  
  // Merge with config overrides if provided
  const breadcrumbConfig = {
    ...defaultBreadcrumbConfig,
    ...(collectionConfig.chunking?.breadcrumb || {})
  };
  
  if (strategy === 'treesitter') {
    return {
      async splitText(text, filePath) {
        // Auto-detect language from file extension
        let language = collectionConfig.chunking.language;
        if (filePath) {
          if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
            language = 'javascript';
          } else if (filePath.endsWith('.php')) {
            language = 'php';
          } else if (filePath.endsWith('.md')) {
            language = 'markdown';
          }
        }
        
        if (language === 'php') {
          return chunkPhp(text, chunkSize, chunkOverlap, logger, filePath);
        }
        if (language === 'markdown') {
          return chunkMarkdown(text, chunkSize, chunkOverlap, logger, filePath, breadcrumbConfig);
        }
        if (language === 'javascript') {
          return chunkJavaScript(text, chunkSize, chunkOverlap, logger);
        }
        throw new Error(`Unsupported language: ${language}`);
      }
    };
  }
  
  if (strategy === 'markdown-header') {
    const effectiveChunkSize = maxChunkSize || chunkSize || 3000;
    const effectiveOverlap = chunkOverlap || 0;
    return {
      async splitText(text, filePath) {
        return chunkMarkdown(text, effectiveChunkSize, effectiveOverlap, logger, filePath, breadcrumbConfig);
      }
    };
  }
  
  throw new Error(`Unknown chunking strategy: ${strategy}`);
}
