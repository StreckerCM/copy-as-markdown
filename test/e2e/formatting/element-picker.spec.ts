/**
 * E2E tests for Copy Element as Markdown: the picker is injected into the page,
 * the user points at an element, widens it with ArrowUp, and clicks to copy.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { resetMockClipboard, triggerContextMenu, waitForMockClipboard } from '../helpers';

const expectedArticle = [
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
].join('\n');

async function waitForPicker(page: Page): Promise<void> {
  // The picker appends its overlay host as a sibling of <body>.
  await page.waitForFunction(() => document.documentElement.children.length > 2);
}

async function pickArticleFromHeading(page: Page): Promise<void> {
  // Playwright locators pierce open shadow roots.
  await page.locator('h1').hover();
  await page.keyboard.press('ArrowUp');
  await page.locator('h1').click();
}

test.describe('Copy Element as Markdown', () => {
  test.beforeEach(async ({ page, serviceWorker }) => {
    await resetMockClipboard(serviceWorker);
    await page.goto('http://localhost:5566/selection-shadow-dom.html');
  });

  test('copies the picked element via the context menu', async ({ page, serviceWorker }) => {
    await triggerContextMenu(serviceWorker, 'element-as-markdown', { frameId: 0 });
    await waitForPicker(page);
    await pickArticleFromHeading(page);

    const clipboardText = (await waitForMockClipboard(serviceWorker, 3000)).text;
    expect(clipboardText).toBe(expectedArticle);
  });

  test('copies the picked element via the keyboard command', async ({ page, serviceWorker }) => {
    await serviceWorker.evaluate(() => {
      // @ts-expect-error - Chrome APIs
      return chrome.commands.onCommand.dispatch('element-as-markdown');
    });
    await waitForPicker(page);
    await pickArticleFromHeading(page);

    const clipboardText = (await waitForMockClipboard(serviceWorker, 3000)).text;
    expect(clipboardText).toBe(expectedArticle);
  });

  test('copies nothing when the picker is cancelled', async ({ page, serviceWorker }) => {
    await triggerContextMenu(serviceWorker, 'element-as-markdown', { frameId: 0 });
    await waitForPicker(page);
    await page.locator('h1').hover();
    await page.keyboard.press('Escape');

    await expect(page.locator('html > *')).toHaveCount(2);
    await expect(waitForMockClipboard(serviceWorker, 1000)).rejects.toThrow('no calls');
  });
});
