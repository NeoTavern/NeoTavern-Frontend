import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';
import { scopeCss, scopeHtml } from '../src/utils/style-scoper';

describe('Style Scoper', () => {
  // Setup JSDOM environment if not present (Vitest usually handles this if configured, but to be safe)
  beforeAll(() => {
    if (typeof global.DOMParser === 'undefined') {
      const jsdom = new JSDOM('');
      global.DOMParser = jsdom.window.DOMParser;
      global.document = jsdom.window.document;
      global.Node = jsdom.window.Node;
    }
  });

  describe('scopeCss', () => {
    const prefix = '.scope-123';

    test('prefixes standard selectors', () => {
      const css = 'div { color: red; } .foo { color: blue; }';
      const result = scopeCss(css, prefix);
      expect(result).toContain('.scope-123 div {');
      expect(result).toContain('.scope-123 .foo {');
    });

    test('handles multiple selectors', () => {
      const css = 'h1, h2, .title { font-weight: bold; }';
      const result = scopeCss(css, prefix);
      expect(result).toContain('.scope-123 h1, .scope-123 h2, .scope-123 .title {');
    });

    test('handles html/body special cases', () => {
      const css = 'body { margin: 0; } html { padding: 0; } body.dark { color: white; }';
      const result = scopeCss(css, prefix);
      expect(result).toContain('.scope-123 { margin: 0; }'); // Replaces body
      expect(result).toContain('.scope-123 { padding: 0; }'); // Replaces html
      expect(result).toContain('.scope-123.dark {'); // Replaces body.dark
    });

    test('handles nested braces (media queries)', () => {
      const css = '@media screen { div { color: red; } }';
      const result = scopeCss(css, prefix);
      expect(result).toContain('@media screen {');
      expect(result).toContain('.scope-123 div {');
    });

    test('skips keyframes steps', () => {
      const css = '@keyframes fade { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }';
      const result = scopeCss(css, prefix);
      // Keyframes itself shouldn't be prefixed, logic might output it as "from {"
      // Our simple parser outputs "from {" without prefix
      expect(result).toContain('from {');
      expect(result).not.toContain('.scope-123 from');
      expect(result).toContain('50% {');
      expect(result).not.toContain('.scope-123 50%');
    });
  });

  describe('scopeHtml', () => {
    test('wraps content in a scoped div', () => {
      const html = '<p>Hello</p>';
      const result = scopeHtml(html);
      expect(result).toMatch(/^<div class="st-scope-[a-z0-9]+"><p>Hello<\/p><\/div>$/);
    });

    test('scopes inline styles', () => {
      const html = `
        <style>
          p { color: red; }
        </style>
        <p>Text</p>
      `;
      const result = scopeHtml(html);

      // Extract the scope ID from the wrapper
      const match = result.match(/class="(st-scope-[a-z0-9]+)"/);
      expect(match).not.toBeNull();
      const scopeId = match![1];

      expect(result).toContain(`.${scopeId} p {`);
      expect(result).toContain('color: red;');
    });

    test('is deterministic for same input', () => {
      const html = '<div>Test</div><style>div { color: blue; }</style>';
      const result1 = scopeHtml(html);
      const result2 = scopeHtml(html);
      expect(result1).toBe(result2);
    });
  });
});
