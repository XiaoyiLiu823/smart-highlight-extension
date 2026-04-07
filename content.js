const HIGHLIGHT_ROOT_ATTR = "data-smart-highlight-root";
const HIGHLIGHT_TOKEN_ATTR = "data-smart-highlight-token";

const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than",
  "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "for", "from", "with",
  "as", "that", "this", "these", "those",
  "it", "its", "he", "she", "they", "them", "their",
  "we", "us", "our", "you", "your",
  "not", "no", "do", "does", "did", "done",
  "have", "has", "had",
  "will", "would", "can", "could", "should", "may", "might",
  "about", "into", "over", "after", "before", "between", "during",
  "also", "more", "most", "such", "very",
  "i", "me", "my", "mine", "his", "her", "hers", "who", "whom",
  "which", "what", "when", "where", "why", "how"
]);

let autoRunTriggered = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrapSessionAutoRun();
  }, { once: true });
} else {
  bootstrapSessionAutoRun();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === "RUN_HIGHLIGHT") {
      clearHighlights();
      const result = runHighlight(message.payload || {});
      sendResponse({ ok: true, freqList: result.freqList });
      return;
    }

    if (message.action === "CLEAR_HIGHLIGHT") {
      clearHighlights();
      sendResponse({ ok: true });
      return;
    }
  } catch (error) {
    console.error("content.js runtime error:", error);
    sendResponse({
      ok: false,
      error: error?.message || String(error)
    });
  }
});

async function bootstrapSessionAutoRun() {
  if (autoRunTriggered) return;
  autoRunTriggered = true;

  try {
    const sessionData = await chrome.storage.session.get(["sessionAutoRun"]);
    if (!sessionData.sessionAutoRun) return;

    const syncData = await chrome.storage.sync.get([
      "keywords",
      "manualThreshold",
      "autoThreshold",
      "sortThreshold",
      "colorStep",
      "excludeKeywords"
    ]);

    const hasUsefulConfig =
      Array.isArray(syncData.keywords) &&
      (
        syncData.keywords.length > 0 ||
        Number(syncData.autoThreshold) > 0
      );

    if (!hasUsefulConfig) return;

    clearHighlights();

    runHighlight({
      keywords: syncData.keywords || [],
      excludeKeywords: syncData.excludeKeywords || [],
      manualThreshold: Math.max(1, Number(syncData.manualThreshold) || 3),
      autoThreshold: Math.max(1, Number(syncData.autoThreshold) || 5),
      sortThreshold: Math.max(1, Number(syncData.sortThreshold) || 30),
      colorStep: Math.max(1, Number(syncData.colorStep) || 30)
    });
  } catch (error) {
    console.error("session auto run error:", error);
  }
}

function runHighlight({
  keywords = [],
  excludeKeywords = [],
  manualThreshold = 3,
  autoThreshold = 5,
  sortThreshold = 30,
  colorStep = 30
}) {
  const textNodes = getTextNodes(document.body);
  const pageText = textNodes.map(node => node.nodeValue).join(" ");

  const normalizedKeywords = keywords.map(s => s.trim()).filter(Boolean);
  const normalizedExcludeKeywords = excludeKeywords.map(s => s.trim()).filter(Boolean);

  const keywordCounts = countManualKeywords(pageText, normalizedKeywords);
  const englishWordCounts = countEnglishWords(pageText);

  const { rules, freqList } = buildRulesAndFreqList({
    keywords: normalizedKeywords,
    excludeKeywords: normalizedExcludeKeywords,
    keywordCounts,
    englishWordCounts,
    manualThreshold,
    autoThreshold,
    sortThreshold,
    colorStep
  });

  applyHighlights(textNodes, rules);

  return { freqList };
}

function getTextNodes(root) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        const excludedTags = ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"];
        if (excludedTags.includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest(`[${HIGHLIGHT_ROOT_ATTR}="true"]`)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  let current = null;
  while ((current = walker.nextNode())) {
    nodes.push(current);
  }
  return nodes;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function countOccurrences(text, keyword) {
  if (!keyword) return 0;

  const escaped = escapeRegExp(keyword);
  let regex;

  if (containsChinese(keyword)) {
    regex = new RegExp(escaped, "g");
  } else {
    regex = new RegExp(`\\b${escaped}\\b`, "gi");
  }

  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function countManualKeywords(pageText, keywords) {
  const result = {};
  for (const keyword of keywords) {
    result[keyword] = countOccurrences(pageText, keyword);
  }
  return result;
}

function countEnglishWords(pageText) {
  const matches = pageText.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const counts = {};

  for (const word of matches) {
    const normalized = word.toLowerCase();
    counts[normalized] = (counts[normalized] || 0) + 1;
  }

  return counts;
}

function getAutoLevel(count, autoThreshold, colorStep) {
  if (count < autoThreshold) return 0;
  const level = Math.floor((count - autoThreshold) / colorStep) + 1;
  return Math.min(level, 5);
}

function buildRulesAndFreqList({
  keywords,
  excludeKeywords,
  keywordCounts,
  englishWordCounts,
  manualThreshold,
  autoThreshold,
  sortThreshold,
  colorStep
}) {
  const rules = [];
  const freqList = [];

  const excludeSetExact = new Set(excludeKeywords);
  const excludeSetLower = new Set(
    excludeKeywords
      .filter(k => !containsChinese(k))
      .map(k => k.toLowerCase())
  );

  const keywordSetLower = new Set(
    keywords
      .filter(k => !containsChinese(k))
      .map(k => k.toLowerCase())
  );

  for (const keyword of keywords) {
    const excluded = containsChinese(keyword)
      ? excludeSetExact.has(keyword)
      : excludeSetLower.has(keyword.toLowerCase());

    if (excluded) continue;

    const count = keywordCounts[keyword] || 0;
    const type = count >= manualThreshold ? "dark" : "light";

    rules.push({
      text: keyword,
      type,
      count,
      isChinese: containsChinese(keyword)
    });

    if (count >= sortThreshold) {
      freqList.push({
        text: keyword,
        count,
        source: "manual"
      });
    }
  }

  for (const [word, count] of Object.entries(englishWordCounts)) {
    if (keywordSetLower.has(word)) continue;
    if (excludeSetLower.has(word)) continue;
    if (EN_STOPWORDS.has(word)) continue;
    if (count < autoThreshold) continue;

    const level = getAutoLevel(count, autoThreshold, colorStep);

    rules.push({
      text: word,
      type: "auto",
      autoLevel: level,
      count,
      isChinese: false
    });

    if (count >= sortThreshold) {
      freqList.push({
        text: word,
        count,
        source: "auto"
      });
    }
  }

  rules.sort((a, b) => {
    if (b.text.length !== a.text.length) {
      return b.text.length - a.text.length;
    }
    return a.text.localeCompare(b.text);
  });

  freqList.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.text.localeCompare(b.text);
  });

  return { rules, freqList };
}

function applyHighlights(textNodes, rules) {
  if (!rules.length) return;

  for (const node of textNodes) {
    const originalText = node.nodeValue;
    let remainingText = originalText;
    let hasHighlight = false;
    const fragment = document.createDocumentFragment();

    while (remainingText.length > 0) {
      const match = findFirstMatch(remainingText, rules);

      if (!match) {
        fragment.appendChild(document.createTextNode(remainingText));
        break;
      }

      const { index, matchedText, rule } = match;

      if (index > 0) {
        fragment.appendChild(document.createTextNode(remainingText.slice(0, index)));
      }

      fragment.appendChild(createHighlightNode(matchedText, rule));
      hasHighlight = true;

      remainingText = remainingText.slice(index + matchedText.length);
    }

    if (!hasHighlight) continue;

    const root = document.createElement("span");
    root.setAttribute(HIGHLIGHT_ROOT_ATTR, "true");
    root.setAttribute("data-original-text", originalText);
    root.appendChild(fragment);

    node.parentNode.replaceChild(root, node);
  }
}

function findFirstMatch(text, rules) {
  let bestMatch = null;

  for (const rule of rules) {
    const escaped = escapeRegExp(rule.text);
    let regex;

    if (rule.isChinese) {
      regex = new RegExp(escaped);
    } else {
      regex = new RegExp(`\\b${escaped}\\b`, "i");
    }

    const result = regex.exec(text);
    if (!result) continue;

    const currentMatch = {
      index: result.index,
      matchedText: result[0],
      rule
    };

    if (!bestMatch) {
      bestMatch = currentMatch;
      continue;
    }

    if (currentMatch.index < bestMatch.index) {
      bestMatch = currentMatch;
      continue;
    }

    if (
      currentMatch.index === bestMatch.index &&
      currentMatch.matchedText.length > bestMatch.matchedText.length
    ) {
      bestMatch = currentMatch;
    }
  }

  return bestMatch;
}

function createHighlightNode(text, rule) {
  const wrapper = document.createElement("span");
  wrapper.classList.add("smart-highlight");
  wrapper.setAttribute(HIGHLIGHT_TOKEN_ATTR, "true");

  if (rule.type === "light") {
    wrapper.classList.add("smart-highlight-light");
  } else if (rule.type === "dark") {
    wrapper.classList.add("smart-highlight-dark");
  } else {
    const level = rule.autoLevel || 1;
    wrapper.classList.add(`smart-highlight-auto-${level}`);
  }

  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  wrapper.appendChild(textSpan);

  if (rule.type === "dark" || rule.type === "auto") {
    const badge = document.createElement("span");
    badge.className = "smart-highlight-badge";
    badge.textContent = String(rule.count);
    wrapper.appendChild(badge);
  }

  return wrapper;
}

function clearHighlights() {
  const roots = document.querySelectorAll(`[${HIGHLIGHT_ROOT_ATTR}="true"]`);

  roots.forEach(root => {
    const originalText = root.getAttribute("data-original-text");
    const restored = document.createTextNode(
      originalText ?? root.textContent ?? ""
    );

    if (root.parentNode) {
      root.parentNode.replaceChild(restored, root);
    }
  });

  document.body.normalize();
}