const keywordsEl = document.getElementById("keywords");
const manualThresholdEl = document.getElementById("manualThreshold");
const autoThresholdEl = document.getElementById("autoThreshold");
const sortThresholdEl = document.getElementById("sortThreshold");
const colorStepEl = document.getElementById("colorStep");
const excludeKeywordsEl = document.getElementById("excludeKeywords");
const sessionAutoRunEl = document.getElementById("sessionAutoRun");
const saveAndRunBtn = document.getElementById("saveAndRun");
const clearHighlightBtn = document.getElementById("clearHighlight");
const statusEl = document.getElementById("status");
const freqListEl = document.getElementById("freqList");

document.addEventListener("DOMContentLoaded", async () => {
  const syncData = await chrome.storage.sync.get([
    "keywords",
    "manualThreshold",
    "autoThreshold",
    "sortThreshold",
    "colorStep",
    "excludeKeywords"
  ]);

  const sessionData = await chrome.storage.session.get([
    "sessionAutoRun"
  ]);

  keywordsEl.value = (syncData.keywords || []).join("\n");
  manualThresholdEl.value = syncData.manualThreshold || 3;
  autoThresholdEl.value = syncData.autoThreshold || 5;
  sortThresholdEl.value = syncData.sortThreshold || 30;
  colorStepEl.value = syncData.colorStep || 30;
  excludeKeywordsEl.value = (syncData.excludeKeywords || []).join("\n");
  sessionAutoRunEl.checked = Boolean(sessionData.sessionAutoRun);
});

sessionAutoRunEl.addEventListener("change", async () => {
  await chrome.storage.session.set({
    sessionAutoRun: sessionAutoRunEl.checked
  });

  statusEl.textContent = sessionAutoRunEl.checked
    ? "已开启会话内自动高亮。"
    : "已关闭会话内自动高亮。";
});

saveAndRunBtn.addEventListener("click", async () => {
  const keywords = keywordsEl.value
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const excludeKeywords = excludeKeywordsEl.value
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const manualThreshold = Math.max(1, Number(manualThresholdEl.value) || 3);
  const autoThreshold = Math.max(1, Number(autoThresholdEl.value) || 5);
  const sortThreshold = Math.max(1, Number(sortThresholdEl.value) || 30);
  const colorStep = Math.max(1, Number(colorStepEl.value) || 30);

  const payload = {
    keywords,
    excludeKeywords,
    manualThreshold,
    autoThreshold,
    sortThreshold,
    colorStep
  };

  await chrome.storage.sync.set(payload);
  await chrome.storage.session.set({
    sessionAutoRun: sessionAutoRunEl.checked
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(
    tab.id,
    {
      action: "RUN_HIGHLIGHT",
      payload
    },
    response => {
      if (chrome.runtime.lastError) {
        console.error("RUN_HIGHLIGHT sendMessage error:", chrome.runtime.lastError.message);
        statusEl.textContent = "当前页面无法执行。请先刷新网页，再试一次。";
        return;
      }

      if (response && response.ok === false) {
        console.error("RUN_HIGHLIGHT content error:", response.error);
        statusEl.textContent = `执行失败：${response.error}`;
        return;
      }

      statusEl.textContent = sessionAutoRunEl.checked
        ? "已执行高亮，并开启会话内自动高亮。"
        : "已执行高亮。";

      renderFreqList(response?.freqList || []);
    }
  );
});

clearHighlightBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(
    tab.id,
    { action: "CLEAR_HIGHLIGHT" },
    response => {
      if (chrome.runtime.lastError) {
        console.error("CLEAR_HIGHLIGHT sendMessage error:", chrome.runtime.lastError.message);
        statusEl.textContent = "当前页面无法执行。请先刷新网页，再试一次。";
        return;
      }

      if (response && response.ok === false) {
        console.error("CLEAR_HIGHLIGHT content error:", response.error);
        statusEl.textContent = `清除失败：${response.error}`;
        return;
      }

      statusEl.textContent = "已清除高亮。";
      renderFreqList([]);
    }
  );
});

function renderFreqList(items) {
  if (!items.length) {
    freqListEl.innerHTML = `<div style="color:#666;">暂无结果</div>`;
    return;
  }

  freqListEl.innerHTML = items
    .map(item => {
      return `
        <div class="freq-item">
          <span class="freq-text">${escapeHtml(item.text)}</span>
          <strong class="freq-count">${item.count}</strong>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}