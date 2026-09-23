/**
 * This function executes in the content script context.
 * It must be self-contained - no external function calls.
 *
 * NOTE: This function should be executed in a content script. It extracts the
 * current selection as an HTML fragment; the HTML→Markdown conversion happens
 * elsewhere (offscreen document on Chrome / Event Page on Firefox).
 */
export function extractSelectionHtml(onlyIfFocused: boolean): string {
  // When triggered without a precise frame (keyboard shortcut), this function runs in
  // every frame. Only the frame the user is actually in should contribute text. A frame
  // is the focused leaf when the document has focus AND its active element is not a nested
  // frame (ancestors of the focused frame report hasFocus() too, but their activeElement is
  // the child frame element). Background iframes that auto-select text do not have focus.
  if (onlyIfFocused) {
    const active = document.activeElement;
    // HTMLFrameElement is the legacy <frame> (framesets); kept for completeness even
    // though modern pages only use <iframe>.
    const activeIsSubFrame
      = active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement;
    if (!document.hasFocus() || activeIsSubFrame) {
      return '';
    }
  }

  const sel = getSelection();
  if (!sel) {
    return '';
  }

  // Range.cloneContents() does not copy shadow roots, so web components that render
  // their content in shadow DOM (e.g. Salesforce's <dx-code-block>) clone as empty
  // tags. Rebuild each such host from the content it actually renders: the shadow
  // tree, with <slot>s filled from the host's (range-clipped) light children.
  const isRendered = (el: Element): boolean => {
    if (['STYLE', 'SCRIPT', 'TEMPLATE', 'BUTTON', 'svg'].includes(el.nodeName)) {
      return false;
    }
    const style = getComputedStyle(el);
    // Line-number gutters and similar chrome are marked user-select: none.
    return style.display !== 'none' && style.visibility !== 'hidden' && style.userSelect !== 'none';
  };

  const composedChildren = (
    root: ShadowRoot,
    lightChildren: (slot: HTMLSlotElement) => Node[],
  ): Node[] => {
    const cloneNode = (node: Node): Node[] => {
      if (node.nodeType === Node.TEXT_NODE) {
        return [node.cloneNode()];
      }
      if (!(node instanceof Element) || !isRendered(node)) {
        return [];
      }
      if (node instanceof HTMLSlotElement) {
        const assigned = lightChildren(node);
        return assigned.length > 0 ? assigned : Array.from(node.childNodes).flatMap(cloneNode);
      }
      const copy = node.cloneNode(false) as Element;
      const children = node.shadowRoot
        ? composedChildren(node.shadowRoot, slot => slot.assignedNodes().flatMap(cloneNode))
        : Array.from(node.childNodes).flatMap(cloneNode);
      copy.append(...children);
      return [copy];
    };
    return Array.from(root.childNodes).flatMap(cloneNode);
  };

  const container = document.createElement('div');
  for (let i = 0, len = sel.rangeCount; i < len; i += 1) {
    const range = sel.getRangeAt(i);
    const fragment = range.cloneContents();

    // cloneContents() copies exactly the elements under the common ancestor that
    // intersect the range, in tree order, so the originals and clones line up.
    const ancestor = range.commonAncestorContainer;
    const originals = ancestor instanceof Element || ancestor instanceof DocumentFragment
      ? Array.from(ancestor.querySelectorAll('*')).filter(el => range.intersectsNode(el))
      : [];
    const originalHosts = originals.filter(el => el.shadowRoot);
    if (originalHosts.length > 0) {
      const clones = Array.from(fragment.querySelectorAll('*'));
      if (originals.length === clones.length) {
        const cloneOf = new Map(originals.map((el, index) => [el, clones[index]!]));
        originalHosts.forEach((host) => {
          const clone = cloneOf.get(host)!;
          const light = Array.from(clone.childNodes);
          clone.replaceChildren(...composedChildren(host.shadowRoot!, (slot) => {
            const name = slot.name;
            return light.filter(node => (
              node instanceof Element ? node.getAttribute('slot') ?? '' : ''
            ) === name);
          }));
        });
      }
    }

    container.appendChild(fragment);
  }

  // Render callout/admonition boxes ("Note", "Warning", ...) as blockquotes. Only
  // the outermost match converts, so nested "-callout" parts are not re-wrapped.
  const isCallout = (el: Element): boolean => el.getAttribute('role') === 'note'
    || Array.from(el.classList).some(c => /^(?:.+-)?(?:callout|admonition)$/.test(c));
  const quotes: Element[] = [];
  Array.from(container.querySelectorAll('*')).forEach((el) => {
    if (!isCallout(el) || quotes.some(quote => quote.contains(el))) {
      return;
    }
    const title = Array.from(el.querySelectorAll('*')).find(
      t => Array.from(t.classList).some(c => /title/.test(c)),
    );
    if (title && title.textContent?.trim()) {
      const strong = document.createElement('strong');
      strong.textContent = title.textContent.trim();
      const p = document.createElement('p');
      p.appendChild(strong);
      title.replaceWith(p);
    }
    const quote = document.createElement('blockquote');
    quote.append(...Array.from(el.childNodes));
    el.replaceWith(quote);
    quotes.push(quote);
  });

  // Fix <a href> so that they are absolute URLs
  container.querySelectorAll('a').forEach((value) => {
    value.setAttribute('href', value.href);
  });

  // Fix <img src> so that they are absolute URLs
  container.querySelectorAll('img').forEach((value) => {
    value.setAttribute('src', value.src);
  });

  // Normalize wrapped PRE blocks into canonical <pre><code>...</code></pre>.
  // This keeps matching conservative and delegates markdown rendering details
  // (fenced vs indented, language handling, fence sizing) to Turndown built-ins.
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.firstElementChild?.nodeName === 'CODE') {
      return;
    }

    const codeNodes = pre.querySelectorAll('code');
    if (codeNodes.length !== 1) {
      return;
    }

    const codeNode = codeNodes[0]!;
    const className = codeNode.getAttribute('class') || '';
    const hasLanguageClass = /\blanguage-\S+\b/.test(className);
    const codeText = codeNode.textContent || '';
    const hasMultilineCode = codeText.includes('\n');

    // Conservative matcher: avoid rewriting instructional <pre> content.
    if (!hasLanguageClass && !hasMultilineCode) {
      return;
    }

    const normalizedCode = document.createElement('code');
    if (className) {
      normalizedCode.setAttribute('class', className);
    }
    normalizedCode.textContent = codeText;
    pre.replaceChildren(normalizedCode);
  });

  return container.innerHTML;
}
