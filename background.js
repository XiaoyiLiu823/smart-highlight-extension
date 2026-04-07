async function ensureSessionAccess() {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"
    });
  } catch (error) {
    console.error("Failed to set session storage access level:", error);
  }
}

// 尽量在各种时机都设置一遍，保证 content script 能读到 storage.session
ensureSessionAccess();

chrome.runtime.onInstalled.addListener(() => {
  ensureSessionAccess();
});

chrome.runtime.onStartup.addListener(() => {
  ensureSessionAccess();
});