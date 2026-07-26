// lib/tools/webSearch.js
// Optional tool — only usable if both GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID are set.
//
// Uses Google's Programmable Search Engine (the "Custom Search JSON API"):
// a genuinely free tier of 100 queries/day, no credit card required to get it.
// (This replaced Brave Search API here after Brave dropped its free tier and
// started requiring a card + metered credits in February 2026 — if Google ever
// does the same, this is the one file to swap out.)
//
// Setup (see README.md for the full walkthrough):
//   1. Create a search engine at programmablesearchengine.google.com, set it
//      to "Search the entire web", and copy its Search Engine ID (cx).
//   2. Enable the "Custom Search API" in a Google Cloud project and create an
//      API key at console.cloud.google.com.

function isAvailable() {
  return !!(
    process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_API_KEY.trim() &&
    process.env.GOOGLE_CSE_ID && process.env.GOOGLE_CSE_ID.trim()
  );
}

async function webSearch(query) {
  if (!isAvailable()) {
    throw new Error('Web search is not configured on this deployment (GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID not set).');
  }
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_API_KEY)}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_ID)}&q=${encodeURIComponent(query)}&num=5`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google Custom Search error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const items = data.items || [];
  return items.slice(0, 5).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet
  }));
}

module.exports = { webSearch, isAvailable };
