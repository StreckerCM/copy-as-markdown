/**
 * E2E tests for copying selections from pages rendered with shadow DOM.
 *
 * The extraction runs in the extension's isolated world, so these cover what the
 * vitest browser tests cannot: shadow roots and composed selections as seen by a
 * real content script.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { resetMockClipboard, triggerContextMenu, waitForMockClipboard } from '../helpers';

async function selectInArticle(page: Page, endInsideCodeBlock: boolean): Promise<void> {
  await page.evaluate((endInCode) => {
    const root = document.querySelector('doc-article')!.shadowRoot!;
    const start = root.querySelector('h1')!.firstChild!;
    const selection = window.getSelection()!;
    if (endInCode) {
      const code = root.querySelector('doc-code-block')!.shadowRoot!.querySelector('code')!;
      const lastLine = code.querySelectorAll('.line')[1]!.firstChild!;
      selection.setBaseAndExtent(start, 0, lastLine, 1);
    } else {
      const end = root.querySelector('#after')!.firstChild!;
      selection.setBaseAndExtent(start, 0, end, 5);
    }
  }, endInsideCodeBlock);
}

test.describe('Selection as Markdown with shadow DOM', () => {
  test.beforeEach(async ({ page, serviceWorker }) => {
    await resetMockClipboard(serviceWorker);
    await page.goto('http://localhost:5566/selection-shadow-dom.html');
  });

  test('copies code blocks and callouts rendered in shadow roots', async ({ page, serviceWorker }) => {
    await selectInArticle(page, false);
    await triggerContextMenu(serviceWorker, 'selection-as-markdown', { frameId: 0 });

    const clipboardText = (await waitForMockClipboard(serviceWorker, 3000)).text;
    expect(clipboardText).toBe([
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

  test('copies a selection that ends inside a shadow-DOM code block', async ({ page, serviceWorker }) => {
    await selectInArticle(page, true);
    await triggerContextMenu(serviceWorker, 'selection-as-markdown', { frameId: 0 });

    const clipboardText = (await waitForMockClipboard(serviceWorker, 3000)).text;
    expect(clipboardText).toBe('# Title\n\nIntro\n\n```\ntype A {\n}\n```');
  });
});
