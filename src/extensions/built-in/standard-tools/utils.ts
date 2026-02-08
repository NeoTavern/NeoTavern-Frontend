/**
 * Fetches HTML content from a URL, optionally using a CORS proxy.
 */
export async function fetchHtml(url: string, proxy?: string): Promise<string> {
  let targetUrl = url;
  if (proxy) {
    // specific logic for common proxies or just concatenation
    targetUrl = `${proxy}${url}`;
  }

  const proxyUrl = `/api/plugins/neo/proxy?url=${encodeURIComponent(targetUrl)}`;

  try {
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    const err = error as Error;
    // Check for common CORS/Network failure indications
    // If no proxy is configured, hint the user about it.
    if (!proxy && (err.name === 'TypeError' || err.message.includes('Failed to fetch'))) {
      throw new Error(
        `Failed to fetch content. This is likely a CORS (Cross-Origin Resource Sharing) issue. ` +
          `Please configure a CORS Proxy in 'Extensions > Standard Tools' settings. Original Error: ${err.message}`,
      );
    }
    throw err;
  }
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

  // Skip hidden elements
  if (el.style.display === 'none' || el.style.visibility === 'hidden') {
    return '';
  }

  // Handle specific elements that require custom traversal
  if (tagName === 'table') {
    return tableToMarkdown(el as HTMLTableElement);
  }

  // Generic traversal for other elements
  let content = '';
  for (const child of Array.from(el.childNodes)) {
    content += htmlToMarkdown(child);
  }

  content = content.trim();

  // If content is empty, some tags usually don't need to be rendered,
  // except maybe self-closing ones like hr or br (though br is handled below).
  if (!content && tagName !== 'hr' && tagName !== 'br' && tagName !== 'td' && tagName !== 'th') {
    return '';
  }

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
      // Avoid empty links or javascript: links
      if (!href || href.startsWith('javascript:')) return content;
      return `[${content}](${href})`;
    }
    case 'code':
      return `\`${content}\``;
    case 'pre':
      return `\n\`\`\`\n${content}\n\`\`\`\n`;
    case 'blockquote':
      return `\n> ${content}\n`;
    case 'dl':
      return `\n${content}\n`;
    case 'dt':
      return `\n**${content}**\n`;
    case 'dd':
      return `: ${content}\n`;
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'header':
    case 'footer':
      return `\n${content}\n`;
    default:
      return `${content} `;
  }
}

/**
 * Converts an HTML Table to Markdown Table.
 */
function tableToMarkdown(table: HTMLTableElement): string {
  // Collect all rows from thead, tbody, tfoot, or direct children
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  // Extract cell data
  const data: string[][] = rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    return cells.map((cell) => {
      // Process cell content, remove newlines to fit in table cell
      return htmlToMarkdown(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
    });
  });

  // Determine number of columns
  const columnCount = data.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) return '';

  // Pad rows with empty strings if necessary
  const paddedData = data.map((row) => {
    while (row.length < columnCount) {
      row.push('');
    }
    return row;
  });

  let markdown = '\n';

  // Use the first row as the header
  const header = paddedData[0];
  markdown += `| ${header.join(' | ')} |\n`;

  // Create separator row
  const separator = Array(columnCount).fill('---');
  markdown += `| ${separator.join(' | ')} |\n`;

  // Add the rest of the rows
  for (let i = 1; i < paddedData.length; i++) {
    markdown += `| ${paddedData[i].join(' | ')} |\n`;
  }

  return markdown + '\n';
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
