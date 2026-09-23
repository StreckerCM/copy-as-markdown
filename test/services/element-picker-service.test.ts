import { describe, expect, it, vi } from 'vitest';
import { createElementPickerService } from '../../src/services/element-picker-service.js';
import type { ScriptingAPI } from '../../src/services/shared-types.js';
import { pickElement } from '../../src/content-scripts/pick-element.js';

function makeTab(id: number | undefined): browser.tabs.Tab {
  return {
    id,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    mutedInfo: { muted: false },
  } as browser.tabs.Tab;
}

describe('elementPickerService', () => {
  it('injects the picker into the given frame', async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const scriptingAPI: ScriptingAPI = { executeScript };

    await createElementPickerService(scriptingAPI).start(makeTab(123), 7);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 123, frameIds: [7] },
      func: pickElement,
    });
  });

  it('defaults to the main frame', async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const scriptingAPI: ScriptingAPI = { executeScript };

    await createElementPickerService(scriptingAPI).start(makeTab(123));

    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 123, frameIds: [0] },
    }));
  });

  it('throws when the tab has no id', async () => {
    const executeScript = vi.fn();
    const scriptingAPI: ScriptingAPI = { executeScript };

    await expect(createElementPickerService(scriptingAPI).start(makeTab(undefined)))
      .rejects
      .toThrow('tab has no id');
    expect(executeScript).not.toHaveBeenCalled();
  });
});
