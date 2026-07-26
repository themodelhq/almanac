(function () {
  const MAX_STEPS = 12;

  const providerSelect = document.getElementById('agentProvider');
  const toolStrip = document.getElementById('agentToolStrip');
  const form = document.getElementById('agentForm');
  const taskEl = document.getElementById('agentTask');
  const runBtn = document.getElementById('agentRunBtn');
  const resetBtn = document.getElementById('agentResetBtn');
  const statusHint = document.getElementById('agentStatusHint');
  const transcriptEl = document.getElementById('agentTranscript');
  const answerRow = document.getElementById('agentAnswerRow');
  const answerInput = document.getElementById('agentAnswerInput');
  const answerBtn = document.getElementById('agentAnswerBtn');

  let state = null; // { providerId, task, transcript, stepCount, running }

  const MIME_BY_EXT = {
    html: 'text/html', htm: 'text/html', md: 'text/markdown', txt: 'text/plain',
    js: 'text/javascript', css: 'text/css', json: 'application/json',
    py: 'text/x-python', csv: 'text/csv', xml: 'application/xml'
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function mimeFor(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    return MIME_BY_EXT[ext] || 'text/plain';
  }

  async function loadProvidersAndTools() {
    try {
      const [provRes, toolsRes] = await Promise.all([fetch('/api/providers'), fetch('/api/tools')]);
      const provData = await provRes.json();
      const toolsData = await toolsRes.json();
      const providers = provData.providers || [];

      if (!providers.length) {
        providerSelect.innerHTML = '<option>No providers configured</option>';
        runBtn.disabled = true;
      } else {
        providerSelect.innerHTML = providers.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
      }

      const bits = [];
      bits.push(toolsData.webSearch ? 'Web search: on' : 'Web search: off (set GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID to enable)');
      bits.push(toolsData.imageGenProvider === 'zai' ? 'Image generation: on (Z.ai)' : 'Image generation: on (Pollinations, free)');
      bits.push(toolsData.videoGen ? 'Video generation: on (Z.ai)' : 'Video generation: off (set ZAI_API_KEY to enable)');
      bits.push('File writing: always on');
      toolStrip.textContent = bits.join(' · ');
    } catch (e) {
      toolStrip.textContent = 'Could not load agent configuration.';
      runBtn.disabled = true;
    }
  }

  function addStepCard({ kind, thought, html }) {
    const card = document.createElement('div');
    card.className = `agent-step ${kind}`;
    card.innerHTML = `
      <div class="step-head"><span>Step ${state.stepCount}${kind !== 'plain' ? ' · ' + kind : ''}</span></div>
      ${thought ? `<div class="step-thought">${escapeHtml(thought)}</div>` : ''}
      ${html}
    `;
    transcriptEl.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function renderSearchResults(query, results) {
    if (!results || !results.length) {
      return `<div class="step-body">Searched for "${escapeHtml(query)}" — no results.</div>`;
    }
    const items = results.map((r) => `
      <li><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title || r.url)}</a><br>${escapeHtml(r.snippet || '')}</li>
    `).join('');
    return `<div class="step-body">Searched the web for "${escapeHtml(query)}":</div><ul class="search-results">${items}</ul>`;
  }

  function renderImage(prompt, dataUrl) {
    return `<div class="step-body">Generated an image for: "${escapeHtml(prompt)}"</div><img class="generated" src="${dataUrl}" alt="${escapeHtml(prompt)}" />`;
  }

  function domSafeId(jobId) {
    return 'video-' + String(jobId).replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function renderVideoPlaceholder(prompt, jobId) {
    const id = domSafeId(jobId);
    return `
      <div class="step-body">Started a video render for: "${escapeHtml(prompt)}"</div>
      <div id="${id}" class="video-status">⏳ Rendering… this can take a couple of minutes. Feel free to keep reading — this updates on its own.</div>
    `;
  }

  async function pollVideo(jobId, attempt = 0) {
    const el = document.getElementById(domSafeId(jobId));
    if (!el) return; // card no longer on screen
    const MAX_ATTEMPTS = 40; // ~40 * 5s = ~3.3 minutes
    try {
      const res = await fetch(`/api/video-status?jobId=${encodeURIComponent(jobId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Video status check failed');

      if (data.status === 'SUCCESS' && data.url) {
        el.innerHTML = `<video class="generated" controls src="${data.url}" ${data.coverUrl ? `poster="${data.coverUrl}"` : ''}></video><a class="file-download" href="${data.url}" target="_blank" rel="noopener">⬇ Open video</a>`;
        return;
      }
      if (data.status === 'FAIL' || data.status === 'FAILED') {
        el.textContent = 'Video render failed.';
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        el.textContent = 'Still rendering after a few minutes — the job may still finish; check back later isn\'t automatic past this point.';
        return;
      }
      setTimeout(() => pollVideo(jobId, attempt + 1), 5000);
    } catch (err) {
      el.textContent = `Could not check video status: ${err.message}`;
    }
  }

  function renderFile(filename, content) {
    const blob = new Blob([content], { type: mimeFor(filename) });
    const url = URL.createObjectURL(blob);
    const preview = content.length > 400 ? content.slice(0, 400) + '…' : content;
    return `
      <div class="step-body">Wrote a file: <strong>${escapeHtml(filename)}</strong> (${content.length.toLocaleString()} characters)</div>
      <pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12px;background:#00000010;padding:8px;border-radius:4px;max-height:160px;overflow:auto;">${escapeHtml(preview)}</pre>
      <a class="file-download" href="${url}" download="${escapeHtml(filename)}">⬇ Download ${escapeHtml(filename)}</a>
    `;
  }

  async function callAgent(body) {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Agent request failed');
    return data;
  }

  async function stepLoop() {
    if (!state || !state.running) return;
    if (state.stepCount >= MAX_STEPS) {
      addStepCard({ kind: 'error', html: `<div class="step-body">Reached the ${MAX_STEPS}-step limit for this task. Start a new task to continue further.</div>` });
      finish();
      return;
    }
    state.stepCount++;
    statusHint.textContent = `Working — step ${state.stepCount}…`;

    let result;
    try {
      result = await callAgent({
        providerId: state.providerId,
        task: state.transcript.length ? undefined : state.task,
        transcript: state.transcript
      });
    } catch (err) {
      addStepCard({ kind: 'error', html: `<div class="step-body">${escapeHtml(err.message)}</div>` });
      finish();
      return;
    }

    if (result.status === 'error') {
      addStepCard({ kind: 'error', thought: result.thought, html: `<div class="step-body">${escapeHtml(result.error)}</div>` });
      finish();
      return;
    }

    if (result.status === 'retry') {
      state.transcript = result.transcript;
      // Invalid JSON from the model — quietly retry, still counts toward the step budget.
      stepLoop();
      return;
    }

    state.transcript = result.transcript;

    if (result.status === 'waiting_for_user') {
      addStepCard({ kind: 'waiting', thought: result.thought, html: `<div class="step-body">${escapeHtml(result.question)}</div>` });
      statusHint.textContent = 'Waiting for your answer below.';
      answerRow.style.display = 'flex';
      answerInput.focus();
      return; // pause — resumes when the user replies
    }

    if (result.status === 'done') {
      addStepCard({ kind: 'final', thought: result.thought, html: `<div class="step-body final">${escapeHtml(result.answer)}</div>` });
      statusHint.textContent = 'Task complete.';
      finish();
      return;
    }

    // status === 'continue'
    let html = '';
    if (result.action === 'web_search' && result.payload) {
      html = renderSearchResults(result.payload.query, result.payload.results);
    } else if (result.action === 'generate_image' && result.payload) {
      html = renderImage(result.payload.prompt, result.payload.dataUrl);
    } else if (result.action === 'generate_video' && result.payload) {
      html = renderVideoPlaceholder(result.payload.prompt, result.payload.jobId);
    } else if (result.action === 'write_file' && result.payload) {
      html = renderFile(result.payload.filename, result.payload.content);
    } else if (result.error) {
      html = `<div class="step-body">Tool call failed: ${escapeHtml(result.error)}</div>`;
    } else {
      html = `<div class="step-body">…</div>`;
    }
    addStepCard({ kind: result.error ? 'error' : (result.action || 'plain'), thought: result.thought, html });

    if (result.action === 'generate_video' && result.payload && result.payload.jobId) {
      pollVideo(result.payload.jobId);
    }

    stepLoop();
  }

  function finish() {
    state.running = false;
    runBtn.disabled = false;
    runBtn.textContent = 'Send the Agent';
    resetBtn.style.display = 'inline-block';
    answerRow.style.display = 'none';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const task = taskEl.value.trim();
    const providerId = providerSelect.value;
    if (!task || !providerId) return;

    transcriptEl.innerHTML = '';
    answerRow.style.display = 'none';
    resetBtn.style.display = 'none';
    runBtn.disabled = true;
    runBtn.textContent = 'Agent is working…';

    state = { providerId, task, transcript: [], stepCount: 0, running: true };
    stepLoop();
  });

  answerBtn.addEventListener('click', () => {
    const answer = answerInput.value.trim();
    if (!answer || !state) return;
    state.transcript = [...state.transcript, { role: 'user', content: answer }];
    answerInput.value = '';
    answerRow.style.display = 'none';
    state.running = true;
    runBtn.disabled = true;
    runBtn.textContent = 'Agent is working…';
    stepLoop();
  });

  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') answerBtn.click();
  });

  resetBtn.addEventListener('click', () => {
    taskEl.value = '';
    transcriptEl.innerHTML = '';
    answerRow.style.display = 'none';
    resetBtn.style.display = 'none';
    statusHint.textContent = '';
    state = null;
    taskEl.focus();
  });

  loadProvidersAndTools();
})();
