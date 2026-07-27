// lib/tools/webSearch.js
// DuckDuckGo has no official public search API, but its lightweight HTML
// results endpoint (html.duckduckgo.com/html/) is free, needs no key or
// signup, and is what this scrapes. That also makes it the most fragile
// integration in this project: it's unofficial, so DuckDuckGo can change its
// markup, rate-limit an IP, or serve a CAPTCHA at any time without notice —
// there's no dashboard or changelog to watch the way there is for an official
// API. If results ever come back empty or this starts throwing, that's the
// first thing to suspect; the regex-based parsing below is the one thing to
// re-check against DuckDuckGo's current HTML.
//
// (This replaced Google's Programmable Search Engine here, which itself
// replaced Brave Search API — both dropped/require it in different ways. If
// DuckDuckGo ever becomes unworkable too, consider it a pattern: free web
// search APIs churn faster than the LLM providers in this project do.)

function isAvailable() {
  return true; // always on — no key, no signup, no config required
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function stripTags(str) {
  return decodeEntities(str.replace(/<[^>]*>/g, '')).trim();
}

function decodeDuckDuckGoRedirect(href) {
  // DuckDuckGo's HTML results wrap links like:
  //   //duckduckgo.com/l/?uddg=<url-encoded-real-url>&rut=...
  // Real, direct hrefs are left as-is.
  if (href.includes('duckduckgo.com/l/')) {
    const match = href.match(/[?&]uddg=([^&]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (e) {
        return href;
      }
    }
  }
  return href.startsWith('//') ? `https:${href}` : href;
}

function parseResults(html, max) {
  const results = [];
  const blockRegex = /<div class="result results_links[^"]*"[\s\S]*?(?=<div class="result results_links|$)/g;
  const blocks = html.match(blockRegex) || [];

  for (const block of blocks) {
    if (results.length >= max) break;
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const url = decodeDuckDuckGoRedirect(linkMatch[1]);
    const title = stripTags(linkMatch[2]);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

async function webSearch(query) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // A plain server-side fetch with no User-Agent is a common way to get
      // blocked outright — this mimics a normal browser request.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    },
    body: `q=${encodeURIComponent(query)}`
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo search error ${res.status}. It may be temporarily rate-limiting this server's IP.`);
  }
  const html = await res.text();
  const results = parseResults(html, 5);
  if (!results.length && /anomaly|unusual traffic|captcha/i.test(html)) {
    throw new Error('DuckDuckGo appears to be rate-limiting or challenging this server right now — try again shortly.');
  }
  return results;
}

module.exports = { webSearch, isAvailable };
