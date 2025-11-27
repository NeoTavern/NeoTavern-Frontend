/**
 * Generates a deterministic short hash from a string.
 * Used to create stable scope IDs for the same content.
 */
function getScopeId(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  // Use absolute value and base36 for a short alphanumeric string
  return 'st-scope-' + Math.abs(hash).toString(36);
}

// TODO: What if an extension wanna interrupt this? Disable it via config?
/**
 * Parses CSS text and prefixes all selectors with a given parent class.
 * Handles standard CSS rules and @media blocks.
 *
 * @param css The raw CSS string
 * @param prefix The class selector to prefix (e.g. ".my-scope")
 */
export function scopeCss(css: string, prefix: string): string {
  // Remove comments to simplify parsing
  const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

  let result = '';
  let buffer = '';
  let depth = 0;
  let inAtBlock = false; // To track if we are inside @media { ... }

  for (let i = 0; i < cleanCss.length; i++) {
    const char = cleanCss[i];

    if (char === '{') {
      if (depth === 0 || (depth === 1 && inAtBlock)) {
        // We are at the start of a block. The buffer contains the selector(s).
        const selectorList = buffer.trim();
        buffer = '';

        // Check if it's an at-rule (like @media)
        if (selectorList.startsWith('@') && depth === 0) {
          // Identify if it's a nesting at-rule (media, supports, document, container)
          const isNesting = /@(media|supports|document|container|layer)/i.test(selectorList);

          if (isNesting) {
            inAtBlock = true;
            result += `${selectorList} {`;
          } else {
            // @keyframes, @font-face, @page, etc. - we usually don't prefix inside these or can't
            // For simplicity, we assume we don't scope inside keyframes (animations are global-ish)
            // But we need to output the line.
            inAtBlock = false; // Treat content as raw
            result += `${selectorList} {`;
          }
        } else {
          // Regular selector(s)
          const scopedSelectors = selectorList
            .split(',')
            .map((s) => {
              s = s.trim();
              if (!s) return '';
              // Don't prefix keyframe steps if we somehow got here (should be caught by @keyframes check usually)
              if (/^([0-9.]+%|from|to)$/.test(s)) return s;

              // Replace 'body' and 'html' with the prefix to ensure they stay within scope
              if (/^(html|body)$/i.test(s)) return prefix;
              if (/^(html|body)[\s.#[]/i.test(s)) return s.replace(/^(html|body)/i, prefix);

              // If selector already includes the prefix (unlikely), return as is
              if (s.includes(prefix)) return s;

              return `${prefix} ${s}`;
            })
            .join(', ');

          result += `${scopedSelectors} {`;
        }
      } else {
        // Just append characters if we are deep inside or inside a raw block
        buffer += char;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        // End of top level block
        result += buffer + '}';
        buffer = '';
        inAtBlock = false;
      } else if (depth === 1 && inAtBlock) {
        // End of block inside @media
        result += buffer + '}';
        buffer = '';
      } else {
        buffer += char;
      }
    } else {
      buffer += char;
    }
  }

  return result + buffer;
}

/**
 * Wraps the HTML content in a scoped div and scopes all inline <style> tags.
 *
 * @param html The sanitized HTML string containing content and potentially style tags
 * @returns The transformed HTML string wrapped in a scoped div
 */
export function scopeHtml(html: string): string {
  // Fast path: if no style tags, just wrap it (or don't, but consistent wrapping is better)
  // We use a stable ID based on content hash to avoid unnecessary re-renders/style injection
  const scopeId = getScopeId(html);

  if (!html.includes('<style')) {
    // We still wrap it because the CSS might target this wrapper (e.g. .scope-id { color: red })
    // although without style tags, there's no custom CSS.
    // But consistent output structure is safer.
    return `<div class="${scopeId}">${html}</div>`;
  }

  // Check for DOMParser (browser environment)
  if (typeof DOMParser === 'undefined') {
    console.warn('DOMParser not available, skipping CSS scoping.');
    return html;
  }

  try {
    const parser = new DOMParser();
    // Parse as HTML. We wrap in body to ensure top-level elements are captured.
    const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    const styles = doc.querySelectorAll('style');

    styles.forEach((style) => {
      if (style.textContent) {
        style.textContent = scopeCss(style.textContent, `.${scopeId}`);
      }
    });

    const wrapper = document.createElement('div');
    wrapper.className = scopeId;

    // Move all nodes from parsed body to wrapper
    while (doc.body.firstChild) {
      wrapper.appendChild(doc.body.firstChild);
    }

    return wrapper.outerHTML;
  } catch (e) {
    console.error('Failed to scope HTML styles:', e);
    // Fallback: return original (risk of global style leak, but content is preserved)
    return html;
  }
}
