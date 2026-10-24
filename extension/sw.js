// Toolbar button and keyboard shortcut: toggle the in-page panel on WhatsApp Web.
const WA_URL = 'https://web.whatsapp.com/';

async function sendToggle(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'wat-toggle' });
}

async function toggle(tab) {
  if (tab?.id !== undefined && tab.url?.startsWith(WA_URL)) {
    try {
      await sendToggle(tab.id);
    } catch {
      // The tab was opened before the extension was installed or reloaded, so
      // it has no content scripts yet. Reloading injects them.
      await chrome.tabs.reload(tab.id);
    }
    return;
  }
  const [waTab] = await chrome.tabs.query({ url: `${WA_URL}*` });
  if (!waTab) {
    await chrome.tabs.create({ url: WA_URL });
    return;
  }
  await chrome.tabs.update(waTab.id, { active: true });
  await chrome.windows.update(waTab.windowId, { focused: true });
  try {
    await sendToggle(waTab.id);
  } catch {
    await chrome.tabs.reload(waTab.id);
  }
}

chrome.action.onClicked.addListener((tab) => {
  toggle(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-panel') toggle(tab);
});
