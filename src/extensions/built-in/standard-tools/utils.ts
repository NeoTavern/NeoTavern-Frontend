/**
 * Fetches HTML content from a URL, optionally using a CORS proxy.
 */
export async function fetchHtml(url: string, proxy?: string): Promise<string> {
  let targetUrl = url;
  if (proxy) {
    // specific logic for common proxies or just concatenation
    targetUrl = `${proxy}${url}`;
  }

  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Basic HTML to Markdown converter.
 * Walks the DOM and produces a simplified Markdown string.
 */
export function htmlToMarkdown(element: Node): string {
  if (element.nodeType === Node.TEXT_NODE) {
    return (element.textContent || '').replace(/\s+/g, ' ');
  }

  if (element.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = element as HTMLElement;
  const tagName = el.tagName.toLowerCase();

  // Handle specific tags
  let content = '';

  // Skip hidden elements
  if (el.style.display === 'none' || el.style.visibility === 'hidden') {
    return '';
  }

  for (const child of Array.from(el.childNodes)) {
    content += htmlToMarkdown(child);
  }

  content = content.trim();

  if (!content) return '';

  switch (tagName) {
    case 'h1':
      return `\n# ${content}\n`;
    case 'h2':
      return `\n## ${content}\n`;
    case 'h3':
      return `\n### ${content}\n`;
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n#### ${content}\n`;
    case 'p':
      return `\n${content}\n`;
    case 'br':
      return '\n';
    case 'hr':
      return '\n---\n';
    case 'ul':
    case 'ol':
      return `\n${content}\n`;
    case 'li':
      return `- ${content}\n`;
    case 'b':
    case 'strong':
      return `**${content}**`;
    case 'i':
    case 'em':
      return `*${content}*`;
    case 'a': {
      const href = el.getAttribute('href');
      return href ? `[${content}](${href})` : content;
    }
    case 'code':
      return `\`${content}\``;
    case 'pre':
      return `\n\`\`\`\n${content}\n\`\`\`\n`;
    case 'blockquote':
      return `\n> ${content}\n`;
    case 'div':
    case 'section':
    case 'article':
    case 'main':
      return `\n${content}\n`;
    default:
      return `${content} `;
  }
}

/**
 * cleans the DOM based on the Python reference implementation.
 * Removes navigation, ads, scripts, styles, etc.
 */
export function cleanDom(doc: Document): HTMLElement {
  const selectorsToRemove = [
    'header',
    'footer',
    'nav',
    '[role="navigation"]',
    '.sidebar',
    '[role="complementary"]',
    '.nav',
    '.menu',
    '.header',
    '.footer',
    '.advertisement',
    '.ads',
    '.cookie-notice',
    '.social-share',
    '.related-posts',
    '.comments',
    '#comments',
    '.popup',
    '.modal',
    '.overlay',
    '.banner',
    '.alert',
    '.notification',
    '.subscription',
    '.newsletter',
    '.share-buttons',
    'script',
    'style',
    'noscript',
    'iframe',
    'button',
    'form',
    'input',
    'textarea',
    'select',
    '.noprint',
    'svg',
    'img', // Removing images for text-only context
  ];

  const root = doc.body || doc.documentElement;

  // Remove unwanted elements
  const elements = root.querySelectorAll(selectorsToRemove.join(', '));
  elements.forEach((el) => el.remove());

  return root;
}
