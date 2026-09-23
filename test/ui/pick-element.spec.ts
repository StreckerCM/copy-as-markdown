import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickElement } from '../../src/content-scripts/pick-element.js';
import { extractSelectionHtml } from '../../src/content-scripts/extract-selection-html.js';
import { htmlToMarkdown } from '../../src/lib/html-to-markdown.js';

if (!customElements.get('picker-code-block')) {
  customElements.define('picker-code-block', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<pre><code>let a = 1;\nlet b = 2;</code></pre>';
    }
  });
}

function mountArticle(): ShadowRoot {
  const host = document.createElement('div');
  host.innerHTML = '<a id="outside" href="#elsewhere">Outside</a>';
  document.body.appendChild(host);
  const article = document.createElement('div');
  document.body.appendChild(article);
  const root = article.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <section id="panel">
      <h2>Panel</h2>
      <p id="para">Some <a href="#here">text</a>.</p>
      <picker-code-block></picker-code-block>
    </section>`;
  return root;
}

function hover(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
}

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function click(el: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 });
  el.dispatchEvent(event);
  return event;
}

function overlayCount(): number {
  // The overlay host is the only element the picker appends to <html>.
  return Array.from(document.documentElement.children)
    .filter(el => el !== document.head && el !== document.body)
    .length;
}

describe('pickElement', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessage = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
  });

  afterEach(() => {
    press('Escape');
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('selects the widened element on click and asks the background to copy it', () => {
    const root = mountArticle();
    pickElement();
    expect(overlayCount()).toBe(1);

    hover(root.querySelector('#para a')!);
    press('ArrowUp'); // <p>
    press('ArrowUp'); // <section>
    const event = click(root.querySelector('#para a')!);

    expect(event.defaultPrevented).toBe(true);
    expect(overlayCount()).toBe(0);
    expect(sendMessage).toHaveBeenCalledWith({ topic: 'copy-picked-element', params: {} });
    expect(htmlToMarkdown(extractSelectionHtml(false), { headingStyle: 'atx', codeBlockStyle: 'fenced' }))
      .toBe(`## Panel\n\nSome [text](${new URL('#here', location.href).href}).\n\n\`\`\`\nlet a = 1;\nlet b = 2;\n\`\`\``);
  });

  it('narrows back with ArrowDown', () => {
    const root = mountArticle();
    pickElement();

    hover(root.querySelector('#para')!);
    press('ArrowUp');
    press('ArrowDown');
    press('Enter');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(window.getSelection()!.toString()).toBe('Some text.');
  });

  it('keeps a widened outline while the pointer moves inside it', () => {
    const root = mountArticle();
    pickElement();

    hover(root.querySelector('#para')!);
    press('ArrowUp'); // <section>
    hover(root.querySelector('#para a')!);
    press('Enter');

    expect(window.getSelection()!.toString()).toContain('Panel');
  });

  it('cancels on Escape without copying', () => {
    const root = mountArticle();
    pickElement();
    hover(root.querySelector('#para')!);
    press('Escape');

    expect(overlayCount()).toBe(0);
    click(root.querySelector('#para')!);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('cancels when started again while active', () => {
    const root = mountArticle();
    pickElement();
    pickElement();

    expect(overlayCount()).toBe(0);
    hover(root.querySelector('#para')!);
    click(root.querySelector('#para')!);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
