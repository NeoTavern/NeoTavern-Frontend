import type { ToolDefinition } from '../../../../types/tools';
import type { StandardToolsSettings } from '../types';
import { cleanDom, fetchHtml, htmlToMarkdown } from '../utils';

export const createUrlInspectorTool = (getSettings: () => StandardToolsSettings): ToolDefinition => ({
  name: 'inspect_url',
  displayName: 'Inspect URL',
  description: 'Fetch and extract the main textual content from a URL.',
  icon: 'fa-solid fa-link',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to inspect',
      },
    },
    required: ['url'],
  },
  action: async (args: { url: string }) => {
    const settings = getSettings();
    const { url } = args;

    if (!url) {
      throw new Error("Missing 'url' parameter");
    }

    let html = '';
    try {
      html = await fetchHtml(url, settings.corsProxy);
    } catch (error) {
      return `Error fetching URL: ${(error as Error).message}`;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Clean DOM (remove scripts, ads, nav)
    const root = cleanDom(doc);

    // Heuristics to find "Main Content" if possible, similar to Readability
    const contentSelectors = ['article', 'main', '.post', '.content', '#content', '#main', '[role="main"]'];

    let targetElement: HTMLElement | null = null;

    for (const selector of contentSelectors) {
      const found = root.querySelectorAll(selector);
      // If we find exactly one match for a major container, prefer it
      if (found.length === 1) {
        targetElement = found[0] as HTMLElement;
        break;
      }
    }

    // Fallback to body/root if no specific main container found
    if (!targetElement) {
      targetElement = root;
    }

    // Convert to Markdown
    let markdown = htmlToMarkdown(targetElement);

    // Truncate logic
    const maxLen = settings.urlInspectorMaxContentLength;
    if (markdown.length > maxLen) {
      markdown = markdown.slice(0, maxLen) + '\n... (content truncated)';
    }

    if (!markdown.trim()) {
      return '(Empty content)';
    }

    return markdown;
  },
});
