import { afterEach, describe, expect, it } from 'vitest';
import { extractSelectionHtml } from '../../src/content-scripts/extract-selection-html.js';
import { htmlToMarkdown } from '../../src/lib/html-to-markdown.js';

// Mirrors Salesforce developer docs: the article lives in an open shadow root, each
// code block is a <dx-code-block> whose <pre> is in its own shadow root (with a
// toolbar and user-select: none line numbers), and notes are <doc-content-callout>
// elements whose "Note" title is in shadow DOM while the body is slotted light DOM.
const codeBlockShadow = `
  <div class="toolbar"><test-tooltip><button>Copy</button></test-tooltip></div>
  <pre class="shiki"><code><span class="n" style="user-select: none">1</span><span class="line">type A {</span>
<span class="n" style="user-select: none">2</span><span class="line">}</span></code></pre>`;

const calloutShadow = `
  <div class="dx-callout dx-callout-note">
    <div class="dx-callout-content">
      <p class="dx-callout-title">Note</p>
      <span class="dx-callout-body"><slot></slot></span>
    </div>
  </div>`;

function defineShadowElement(tag: string, html: string): void {
  if (customElements.get(tag)) {
    return;
  }
  customElements.define(tag, class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = html;
    }
  });
}

defineShadowElement('test-code-block', codeBlockShadow);
defineShadowElement('test-callout', calloutShadow);
defineShadowElement('test-tooltip', '<span style="display: none">Copy code</span><slot></slot>');

function mountArticle(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <div id="article">
      <h1>Title</h1>
      <p>Intro</p>
      <div class="codeSection"><test-code-block></test-code-block></div>
      <test-callout><p>Callout body</p></test-callout>
      <p id="after">After</p>
    </div>`;
  return root;
}

function select(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function toMarkdown(): string {
  return htmlToMarkdown(extractSelectionHtml(false), {
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
}

describe('extractSelectionHtml with shadow DOM', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('includes code blocks rendered in shadow roots, without line numbers or toolbar', () => {
    const root = mountArticle();
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('#article')!);
    select(range);

    expect(toMarkdown()).toBe([
      '# Title',
      '',
      'Intro',
      '',
      '```',
      'type A {',
      '}',
      '```',
      '',
      '> **Note**',
      '> ',
      '> Callout body',
      '',
      'After',
    ].join('\n'));
  });

  it('keeps slotted content clipped to the selection', () => {
    const root = mountArticle();
    const body = root.querySelector('test-callout p')!.firstChild!;
    const range = document.createRange();
    range.setStart(body, 'Callout '.length);
    range.setEnd(root.querySelector('#after')!.firstChild!, 3);
    select(range);

    expect(toMarkdown()).toBe('> **Note**\n> \n> body\n\nAft');
  });

  it('includes the whole code block when the selection ends inside its shadow root', () => {
    const root = mountArticle();
    const code = root.querySelector('test-code-block')!.shadowRoot!.querySelector('code')!;
    const lastLine = code.querySelectorAll('.line')[1]!.firstChild!;
    window.getSelection()!.setBaseAndExtent(
      root.querySelector('h1')!.firstChild!,
      0,
      lastLine,
      1,
    );

    expect(toMarkdown()).toBe('# Title\n\nIntro\n\n```\ntype A {\n}\n```');
  });

  it('fills slots inside the selection with the content assigned to them', () => {
    // Like Salesforce's <doc-content-layout>: the article is slotted into a wrapper
    // in the layout's shadow tree, next to a feedback widget.
    const layout = document.createElement('div');
    layout.innerHTML = '<article><h2>Article</h2><test-code-block></test-code-block></article>';
    document.body.appendChild(layout);
    const root = layout.attachShadow({ mode: 'open' });
    root.innerHTML = '<nav>Sidebar</nav><div id="body"><slot></slot><p>Feedback</p></div>';
    const range = document.createRange();
    range.selectNode(root.querySelector('#body')!);
    select(range);

    expect(toMarkdown()).toBe('## Article\n\n```\ntype A {\n}\n```\n\nFeedback');
  });

  it('flattens nested shadow hosts inside a light-DOM selection', () => {
    document.body.innerHTML = '<div id="s"><p>Before</p><test-code-block></test-code-block></div>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#s')!);
    select(range);

    expect(toMarkdown()).toBe('Before\n\n```\ntype A {\n}\n```');
  });

  it('converts role="note" and admonition containers to blockquotes', () => {
    document.body.innerHTML = `<div id="s">
      <div class="theme-admonition"><div class="admonition-heading">Tip</div><p>Use it.</p></div>
      <aside role="note"><p>Plain note.</p></aside>
    </div>`;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#s')!);
    select(range);

    expect(toMarkdown()).toBe('> Tip\n> \n> Use it.\n\n> Plain note.');
  });
});
