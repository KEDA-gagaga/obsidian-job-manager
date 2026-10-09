const HOST = 'kg.keda.job_capture';
const allowed = new Set(['context', 'preview', 'save', 'undo', 'open']);
let saving = false;
chrome.action.onClicked.addListener(async tab => {
  const {captureWindow} = await chrome.storage.session.get('captureWindow');
  if (captureWindow?.tabId === tab.id && captureWindow.url === tab.url) {
    try { await chrome.windows.update(captureWindow.windowId, {focused: true}); return; } catch (_) {}
  }
  const url = chrome.runtime.getURL('popup.html') + '?sourceTab=' + tab.id;
  const window = await chrome.windows.create({url, type: 'popup', width: 460, height: 740, focused: true});
  await chrome.storage.session.set({captureWindow: {tabId: tab.id, url: tab.url, windowId: window.id}});
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('popup.html') || message?.type !== 'bridge' || !allowed.has(message.request?.action)) return false;
  const request = message.request;
  (async () => {
    if (request.action === 'save' && saving) return {ok: false, error: '正在保存，请等待结果后再试。'};
    const tracked = request.action === 'save';
    let response;
    try {
      if (tracked) {
        saving = true;
        await chrome.storage.session.set({lastCapture: {pending: true, url: request.payload?.url, payload: request.payload, savedAt: Date.now()}});
      }
      response = await chrome.runtime.sendNativeMessage(HOST, request);
    } catch (error) {
      const detail = String(error.message || error);
      response = {ok: false, error: /not found|Failed to start/i.test(detail) ? '本机连接未就绪。请运行“安装本机连接.command”，再重新打开扩展。' : /forbidden/i.test(detail) ? '扩展编号与本机连接不一致，请重新运行安装本机连接。' : '无法连接 Obsidian：' + detail};
    } finally {
      if (tracked) saving = false;
    }
    if (tracked) await chrome.storage.session.set({lastCapture: {pending: false, url: request.payload?.url, payload: request.payload, savedAt: Date.now(), response}});
    return response;
  })().then(sendResponse, error => sendResponse({ok: false, error: String(error.message || error)}));
  return true;
});
