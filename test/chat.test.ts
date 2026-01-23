import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';
import { formatText } from '../src/utils/chat';

describe('Chat Utils', () => {
  beforeAll(() => {
    if (typeof global.DOMParser === 'undefined') {
      const jsdom = new JSDOM('');
      global.DOMParser = jsdom.window.DOMParser;
      global.document = jsdom.window.document;
      global.Node = jsdom.window.Node;
      global.window = jsdom.window as unknown as Window & typeof globalThis;
    }
  });

  describe('formatText', () => {
    test('renders images when external media is allowed', () => {
      const input = '![alt text](https://example.com/image.png)';
      const result = formatText(input, false);
      // formatText scopes html, so look for img tag inside
      expect(result).toContain('<img');
      expect(result).toContain('src="https://example.com/image.png"');
    });

    test('removes images when external media is forbidden', () => {
      const input = '![alt text](https://example.com/image.png)';
      const result = formatText(input, true);
      expect(result).not.toContain('<img');
      expect(result).not.toContain('src="https://example.com/image.png"');
    });

    test('allows regular text', () => {
      const input = 'Hello world';
      const result = formatText(input, true);
      expect(result).toContain('Hello world');
    });

    test('sanitizes scripts regardless of setting', () => {
      const input = '<script>alert("xss")</script>Hello';
      const resultAllowed = formatText(input, false);
      const resultForbidden = formatText(input, true);

      expect(resultAllowed).not.toContain('<script');
      expect(resultForbidden).not.toContain('<script');
    });

    test('removes audio/video when forbidden', () => {
      const input = '<video src="movie.mp4"></video>';
      const result = formatText(input, true);
      expect(result).not.toContain('<video');
    });

    test('Should preserve complex HTML structure (div wrapper) without Markdown interference', () => {
      const input = `
      <div class="card">
          <div class="header">
              Title
          </div>
          <div class="content">
              Body text
          </div>
      </div>`;

      const result = formatText(input, true);

      expect(result).toContain('<div class="card">');
      expect(result).toContain('<div class="header">');
      // Should NOT contain Markdown code blocks (pre/code) which happen if indentation is misinterpreted
      expect(result).not.toContain('<pre>');
    });

    test('Should preserve <style> tags and apply scoping', () => {
      // Use unique color to verify existence
      const cssProp = 'color: #ff0099';
      const input = `
        <div class="styled-component">
            <style>
                .styled-component { ${cssProp}; background: #000; }
                .styled-component:hover { opacity: 0.8; }
            </style>
            <p>Styled Text</p>
        </div>`;

      const result = formatText(input, true);

      // 1. Check style tag exists
      expect(result).toContain('<style>');

      // 2. Check CSS content is preserved (specifically the property)
      expect(result).toContain(cssProp);

      // 3. Check HTML structure
      expect(result).toContain('<div class="styled-component">');

      // 4. Ensure no code blocks formed around the style
      expect(result).not.toContain('<pre><code');
    });

    test('Should preserve arbitrary wrappers (e.g. span)', () => {
      const input = `<span class="custom-badge"> <strong>Status:</strong> Active </span>`;
      const result = formatText(input, true);

      expect(result).toContain('<span class="custom-badge">');
      expect(result).toContain('<strong>Status:</strong>');
    });

    test('Should preserve complex CSS features like @keyframes', () => {
      const input = `<div class="animation-container">
    <style>
        .animation-container {
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); opacity: 0.5; }
        }
    </style>
    <div class="content">Animated Content</div>
</div>`;

      const result = formatText(input, true);

      // Verify structure matches input (root div preserved)
      expect(result).toContain('<div class="animation-container">');

      // Verify style tag exists
      expect(result).toContain('<style>');

      // Verify @keyframes content was not stripped by sanitizer
      expect(result).toContain('@keyframes pulse');
      expect(result).toContain('transform: scale(1.1)');
    });

    test('Should parse markdown-like text with angle brackets (not HTML)', () => {
      const input = `<Info_Board>
📅: Unknown | Eternal Spring | 68°F | 🌙 | Clear
🕒: Dusk
🗺️: [Location: Seraphina's Glade (Heart of Eldoria)] | [Characters Present: Seraphina, Joe] | [Action: Recovery & Observation]
💎: [Hunger: Low] | [Energy: Low (Recovering)] | [Physical Position: Sitting up on bedding] | [Social: Cautious] | [Hygiene: Needs care] | [Physical Comfort: Sore]
👗: Black sundress
👔: Torn, blood-stained traveler's clothes
💭: [Thoughts: Assessing the stranger's state, monitoring the glade's energy] | [Emotions: Relieved, watchful, concerned]
🦄: [Horny: None] | [Tension: Low (Post-crisis calm)] | [Fantasy: None]
</Info_Board>`;

      const result = formatText(input, false);

      // Should treat this as markdown and preserve line breaks (converted to <br>)
      // The content should be wrapped in <p> tags by markdown parser
      expect(result).toContain('<br>');

      // Should not be treated as raw HTML block
      // The angle brackets should be escaped or wrapped in paragraph tags
      expect(result).toContain('📅');
      expect(result).toContain('Dusk');

      // Verify multiple lines are preserved with breaks
      const brCount = (result.match(/<br>/g) || []).length;
      expect(brCount).toBeGreaterThan(3); // Multiple line breaks expected
    });

    test('Should handle mixed false-positive HTML tags with real HTML', () => {
      const input = `<Info_Board>
Character: **Alice**
Status: <strong>Active</strong>
Mood: Happy :)
</Info_Board>

Regular text with <em>real emphasis</em> and <code>code</code>.

<Another_Custom_Tag>
More content here
With line breaks
</Another_Custom_Tag>`;

      const result = formatText(input, false);

      // Unknown tags should be escaped and treated as text
      expect(result).toContain('&lt;Info_Board&gt;');
      expect(result).toContain('&lt;/Info_Board&gt;');
      expect(result).toContain('&lt;Another_Custom_Tag&gt;');

      // Real HTML tags should work
      expect(result).toContain('<strong>Active</strong>');
      expect(result).toContain('<em>real emphasis</em>');
      expect(result).toContain('<code>code</code>');

      // Markdown should work (** for bold)
      expect(result).toContain('<strong>Alice</strong>');

      // Line breaks should be preserved
      expect(result).toContain('<br>');
      const brCount = (result.match(/<br>/g) || []).length;
      expect(brCount).toBeGreaterThan(3);
    });

    test('Should allow real HTML block tags inline with markdown', () => {
      const input = `# Heading

<div class="alert">
This is an alert
With multiple lines
</div>

Regular **markdown** text.

<section>
<h2>Section Title</h2>
<p>Paragraph text</p>
</section>`;

      const result = formatText(input, false);

      // Real HTML tags should be preserved
      expect(result).toContain('<div class="alert">');
      expect(result).toContain('<section>');
      expect(result).toContain('<h2>Section Title</h2>');
      expect(result).toContain('<p>Paragraph text</p>');

      // Markdown should still work outside HTML blocks
      expect(result).toContain('<h1');
      expect(result).toContain('<strong>markdown</strong>');

      // Note: Line breaks INSIDE block-level HTML elements are preserved as whitespace,
      // not converted to <br> tags. This is correct markdown behavior.
      // Block HTML is treated as raw HTML by the parser.
      expect(result).toContain('This is an alert');
      expect(result).toContain('With multiple lines');
    });

    test('Should escape custom tags regardless of case', () => {
      const input = `<CustomTag>Content</CustomTag>
<customtag>More content</customtag>
<Info_Board>Data</Info_Board>
<ALLCAPS>Text</ALLCAPS>`;

      const result = formatText(input, false);

      // All custom tags should be escaped
      expect(result).toContain('&lt;CustomTag&gt;');
      expect(result).toContain('&lt;/CustomTag&gt;');
      expect(result).toContain('&lt;customtag&gt;');
      expect(result).toContain('&lt;/customtag&gt;');
      expect(result).toContain('&lt;Info_Board&gt;');
      expect(result).toContain('&lt;ALLCAPS&gt;');

      // Content should still be visible
      expect(result).toContain('Content');
      expect(result).toContain('More content');

      // Line breaks should be preserved
      expect(result).toContain('<br>');
    });
  });
});
