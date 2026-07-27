// lib/tools/videoGen.js
// Video generation only exists via Z.ai (no free, keyless alternative like
// Pollinations exists for video) — so this tool is entirely optional and only
// appears in Agent Mode if ZAI_API_KEY is set.
//
// Z.ai's video endpoint is asynchronous: you submit a prompt and get a job id
// back immediately, then poll a separate endpoint until it's done. Rendering
// commonly takes 1-3 minutes — far longer than a single serverless request
// should block for — so the agent loop only submits the job; the frontend
// polls /api/video-status independently, outside the step budget entirely.
//
// Verify against docs.z.ai/api-reference if this starts erroring — async video
// APIs are exactly the kind of thing that gets a parameter or path renamed
// between versions, and this was written from documentation excerpts rather
// than a live test against the endpoint.

const BASE = 'https://api.z.ai/api/paas/v4';

function isAvailable() {
  return !!(process.env.ZAI_API_KEY && process.env.ZAI_API_KEY.trim());
}

async function submitVideo(prompt) {
  if (!isAvailable()) {
    throw new Error('Video generation is not configured on this deployment (ZAI_API_KEY not set).');
  }
  const res = await fetch(`${BASE}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`
    },
    body: JSON.stringify({ model: 'cogvideox-3', prompt })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Z.ai video error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.id) throw new Error('Z.ai video submission did not return a job id.');
  return { jobId: data.id, status: data.task_status || 'PROCESSING' };
}

async function checkVideo(jobId) {
  if (!isAvailable()) {
    throw new Error('Video generation is not configured on this deployment (ZAI_API_KEY not set).');
  }
  const res = await fetch(`${BASE}/async-result/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${process.env.ZAI_API_KEY}` }
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Z.ai video status error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const status = data.task_status || data.status || 'PROCESSING';
  const result = (data.video_result && data.video_result[0]) || null;
  return {
    status,
    url: result ? result.url : null,
    coverUrl: result ? result.cover_image_url : null
  };
}

module.exports = { isAvailable, submitVideo, checkVideo };
