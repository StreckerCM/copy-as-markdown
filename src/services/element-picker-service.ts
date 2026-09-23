import type { ScriptingAPI } from './shared-types.js';
import { pickElement } from '../content-scripts/pick-element.js';

export interface ElementPickerService {
  /**
   * Start the element picker in a tab. Returns once the picker is running; the copy
   * happens later, when the picker sends a `copy-picked-element` message.
   *
   * @param tab - The browser tab to pick from
   * @param frameId - The frame the user interacted with (from contextMenus.OnClickData).
   *   Defaults to the main frame, e.g. for the keyboard shortcut.
   */
  start: (tab: browser.tabs.Tab, frameId?: number) => Promise<void>;
}

export function createElementPickerService(scriptingAPI: ScriptingAPI): ElementPickerService {
  return {
    async start(tab, frameId = 0) {
      if (!tab.id) {
        throw new Error('tab has no id');
      }
      await scriptingAPI.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        func: pickElement,
      });
    },
  };
}

export function createBrowserElementPickerService(): ElementPickerService {
  return createElementPickerService(browser.scripting);
}
