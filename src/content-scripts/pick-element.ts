/**
 * This function executes in the content script context.
 * It must be self-contained - no external function calls.
 *
 * Starts an element picker, like the DevTools inspector: the element under the
 * pointer is outlined, ArrowUp/ArrowDown widen or narrow the outline to the
 * surrounding element, and a click (or Enter) picks it. The picked element is
 * selected, then the background is asked to copy the selection, so it goes through
 * the same extraction as Copy Selection as Markdown. Escape or right-click cancels.
 * Running it again while a picker is active cancels that picker.
 */
export function pickElement(): void {
  const pickerWindow = window as Window & { __copyAsMarkdownCancelPicker?: () => void };
  if (pickerWindow.__copyAsMarkdownCancelPicker) {
    pickerWindow.__copyAsMarkdownCancelPicker();
    return;
  }

  // The overlay lives in a closed shadow root so page styles cannot reach it, and it
  // is styled through CSSOM so a page CSP that blocks inline <style> cannot break it.
  const host = document.createElement('div');
  const hostStyle: Record<string, string> = {
    'all': 'initial',
    'position': 'fixed',
    'inset': '0',
    'pointer-events': 'none',
    'z-index': '2147483647',
  };
  const box = document.createElement('div');
  const boxStyle: Record<string, string> = {
    'position': 'fixed',
    'pointer-events': 'none',
    'box-sizing': 'border-box',
    'border': '2px solid #1a73e8',
    'background': 'rgba(26, 115, 232, 0.12)',
  };
  const tip = document.createElement('div');
  const tipStyle: Record<string, string> = {
    'position': 'fixed',
    'pointer-events': 'none',
    'max-width': '90vw',
    'overflow': 'hidden',
    'text-overflow': 'ellipsis',
    'white-space': 'nowrap',
    'padding': '4px 8px',
    'border-radius': '4px',
    'background': '#1a73e8',
    'color': '#fff',
    'font': '12px/1.4 system-ui, sans-serif',
  };
  const applyStyle = (el: HTMLElement, style: Record<string, string>): void => {
    Object.entries(style).forEach(([name, value]) => el.style.setProperty(name, value, 'important'));
  };
  applyStyle(host, hostStyle);
  applyStyle(box, boxStyle);
  applyStyle(tip, tipStyle);
  const root = host.attachShadow({ mode: 'closed' });
  root.append(box, tip);

  let target: Element | null = null;
  // Elements the outline was widened from, so ArrowDown can retrace the path.
  const narrower: Element[] = [];
  // Swallowed while picking, so a pick doesn't also follow links or trigger page UI.
  const blockedEvents = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'];

  // Parent in the composed tree: crosses out of shadow roots to their host.
  const parentOf = (el: Element): Element | null => el.parentElement
    ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : '';
    const className = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return `${el.localName}${id}${className ? `.${className}` : ''}`;
  };

  const draw = (): void => {
    if (!target) {
      box.style.setProperty('display', 'none', 'important');
      tip.textContent = 'Copy as Markdown: point at the content to copy · Esc to cancel';
      tip.style.setProperty('top', '4px', 'important');
      tip.style.setProperty('left', '4px', 'important');
      return;
    }
    const rect = target.getBoundingClientRect();
    box.style.setProperty('display', 'block', 'important');
    box.style.setProperty('left', `${rect.left}px`, 'important');
    box.style.setProperty('top', `${rect.top}px`, 'important');
    box.style.setProperty('width', `${rect.width}px`, 'important');
    box.style.setProperty('height', `${rect.height}px`, 'important');

    tip.textContent = `${describe(target)} — ↑ wider · ↓ narrower · click to copy · Esc to cancel`;
    tip.style.setProperty('display', 'block', 'important');
    const top = Math.min(Math.max(rect.top - 28, 4), window.innerHeight - 28);
    tip.style.setProperty('top', `${top}px`, 'important');
    tip.style.setProperty('left', `${Math.max(rect.left, 4)}px`, 'important');
  };

  const cleanup = (): void => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('scroll', draw, true);
    window.removeEventListener('resize', draw, true);
    window.removeEventListener('keydown', onKey, true);
    blockedEvents.forEach(type => window.removeEventListener(type, onPointer, true));
    host.remove();
    delete pickerWindow.__copyAsMarkdownCancelPicker;
  };

  const pick = (el: Element): void => {
    cleanup();
    const range = document.createRange();
    range.selectNode(el);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // `chrome` exists in both Chrome and Firefox content scripts; `browser` is Firefox-only.
    Promise.resolve(chrome.runtime.sendMessage({ topic: 'copy-picked-element', params: {} }))
      .catch(error => console.error('Copy as Markdown: failed to copy picked element', error));
  };

  function onMove(event: MouseEvent): void {
    const el = event.composedPath()[0];
    if (!(el instanceof Element) || el === host || el === target) {
      return;
    }
    // Once widened with ArrowUp, keep the outline while the pointer stays inside it,
    // so moving the mouse to click doesn't undo the widening.
    if (target && narrower.length > 0) {
      for (let ancestor: Element | null = el; ancestor; ancestor = parentOf(ancestor)) {
        if (ancestor === target) {
          return;
        }
      }
    }
    target = el;
    narrower.length = 0;
    draw();
  }

  function onKey(event: KeyboardEvent): void {
    if (!['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      cleanup();
      return;
    }
    if (!target) {
      return;
    }
    if (event.key === 'Enter') {
      pick(target);
      return;
    }
    if (event.key === 'ArrowUp') {
      const parent = parentOf(target);
      if (parent) {
        narrower.push(target);
        target = parent;
      }
    } else if (narrower.length > 0) {
      target = narrower.pop()!;
    }
    draw();
  }

  function onPointer(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'contextmenu') {
      cleanup();
    } else if (event.type === 'click' && (event as MouseEvent).button === 0 && target) {
      pick(target);
    }
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('scroll', draw, true);
  window.addEventListener('resize', draw, true);
  window.addEventListener('keydown', onKey, true);
  blockedEvents.forEach(type => window.addEventListener(type, onPointer, true));
  pickerWindow.__copyAsMarkdownCancelPicker = cleanup;
  document.documentElement.append(host);
  draw();
}
