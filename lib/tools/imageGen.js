// lib/tools/imageGen.js
// Two backends, tried in order:
//  1. Z.ai's image model (cogview-3-flash), if ZAI_API_KEY is set — generally
//     higher quality, and uses the same key that already unlocks a free GLM
//     scribe and (optionally) video generation.
//  2. Pollinations.ai — always available, free, no key, no signup. This was
//     the sole backend before Z.ai support was added and remains the fallback
//     if Z.ai errors or isn't configured.

const ZAI_BASE = 'https://api.z.ai/api/paas/v4';

function zaiConfigured() {
  return !!(process.env.ZAI_API_KEY && process.env.ZAI_API_KEY.trim());
}

async function bufferToDataUrl(res, fallbackType) {
  const contentType = res.headers.get('content-type') || fallbackType;
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function generateViaZai(prompt) {
  const res = await fetch(`${ZAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`
    },
    body: JSON.stringify({ model: 'cogview-3-flash', prompt })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Z.ai image error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const item = data.data && data.data[0];
  if (!item) throw new Error('Z.ai image generation returned no image.');

  if (item.b64_json) {
    return { dataUrl: `data:image/png;base64,${item.b64_json}`, prompt, via: 'zai' };
  }
  if (item.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`Could not download generated image (${imgRes.status}).`);
    const dataUrl = await bufferToDataUrl(imgRes, 'image/png');
    return { dataUrl, prompt, via: 'zai' };
  }
  throw new Error('Z.ai image generation returned an unexpected response shape.');
}

async function generateViaPollinations(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Image generation failed (${res.status}). Pollinations may be temporarily unavailable.`);
  }
  const dataUrl = await bufferToDataUrl(res, 'image/jpeg');
  return { dataUrl, prompt, via: 'pollinations' };
}

async function generateImage(prompt) {
  if (zaiConfigured()) {
    try {
      return await generateViaZai(prompt);
    } catch (err) {
      console.error('Z.ai image generation failed, falling back to Pollinations:', err.message);
    }
  }
  return generateViaPollinations(prompt);
}

module.exports = { generateImage, zaiConfigured };
