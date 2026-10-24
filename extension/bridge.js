// Isolated-world relay: the page-world panel cannot receive extension messages
// itself, so forward the toggle request through window.postMessage.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'wat-toggle') return;
  window.postMessage({ source: 'wa-tools-bridge', type: 'toggle' }, location.origin);
  sendResponse({ ok: true });
});
