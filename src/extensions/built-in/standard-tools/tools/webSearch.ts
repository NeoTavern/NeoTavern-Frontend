import type { ToolDefinition } from '../../../../types/tools';
import type { StandardToolsSettings } from '../types';
import { fetchHtml } from '../utils';

export const createWebSearchTool = (getSettings: () => StandardToolsSettings): ToolDefinition => ({
  name: 'web_search',
  displayName: 'Web Search',
  description: 'Search the web using DuckDuckGo to find information, documentation, or code examples.',
  icon: 'fa-solid fa-magnifying-glass',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
    },
    required: ['query'],
  },
  action: async (args: { query: string }) => {
    const settings = getSettings();
    const { query } = args;

    if (!query) {
      throw new Error("Missing 'query' parameter");
    }

    // DuckDuckGo HTML endpoint
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    let html = '';
    try {
      html = await fetchHtml(url, settings.corsProxy);
    } catch (error) {
      return `Error fetching search results: ${(error as Error).message}`;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Selectors based on DDG HTML structure
    const results = doc.querySelectorAll('.web-result');
    const output: string[] = [];

    let count = 0;
    for (const row of Array.from(results)) {
      if (count >= settings.webSearchMaxResults) break;

      const titleEl = row.querySelector('h2.result__title > a.result__a');
      const snippetEl = row.querySelector('.result__snippet');

      if (titleEl) {
        const title = titleEl.textContent?.trim() || 'No Title';
        const link = titleEl.getAttribute('href') || '';
        const snippet = snippetEl?.textContent?.trim() || '';

        if (link) {
          count++;
          output.push(`**${count}. ${title}**\n   URL: ${link}\n   > ${snippet}`);
        }
      }
    }

    if (output.length === 0) {
      return 'No results found.';
    }

    return output.join('\n\n');
  },
});
