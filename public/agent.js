(function () {
  const MAX_STEPS = 12;
  const SESSIONS_KEY = 'almanac:agent-sessions';
  const MAX_SESSIONS = 30;
  const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // matches the server-side cap in lib/tools/fileIngest.js

  const KIND_LABELS = {
    web_search: 'Web search', generate_image: 'Image', generate_video: 'Video',
    write_file: 'File', error: 'Error', waiting: 'Question', final: 'Final answer', plain: 'Step'
  };

  const providerSelect = document.getElementById('agentProvider');
  const toolStrip = document.getElementById('agentToolStrip');
  const form = document.getElementById('agentForm');
  const taskEl = document.getElementById('agentTask');
  const runBtn = document.getElementById('agentRunBtn');
  const resetBtn = document.getElementById('agentResetBtn');
  const statusHint = document.getElementById('agentStatusHint');
  const chatThread = document.getElementById('agentChatThread');
  const emptyState = document.getElementById('agentEmptyState');
  const answerRow = document.getElementById('agentAnswerRow');
  const answerInput = document.getElementById('agentAnswerInput');
  const answerBtn = document.getElementById('agentAnswerBtn');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('agentFileInput');
  const chipsEl = document.getElementById('attachmentChips');
  const historyPane = document.getElementById('historyPane');

  let state = null;             // the active session
  let pendingFiles = [];        // File[] chosen but not yet sent
  let pendingAttachments = [];  // base64 attachments for the in-flight session's first call

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

  function genId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }

  function deriveTitle(task) {
    const t = task.trim().replace(/\s+/g, ' ');
    return t.length > 48 ? t.slice(0, 48) + '…' : t;
  }

  function relTime(ts) {
    const diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const h = Math.round(diffMin / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  // --- Session persistence (localStorage, per-device) ---

  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveSessions(list) {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS))); }
    catch (e) { /* storage unavailable — sessions just won't persist across reloads */ }
  }

  function persistSession() {
    if (!state) return;
    const list = loadSessions();
    const idx = list.findIndex((s) => s.id === state.id);
    const record = {
      id: state.id, title: state.title, createdAt: state.createdAt, updatedAt: Date.now(),
      providerId: state.providerId, task: state.task, transcript: state.transcript,
      entries: state.entries, status: state.status
    };
    if (idx >= 0) list[idx] = record; else list.unshift(record);
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    saveSessions(list);
    renderHistoryPane();
  }

  function renderHistoryPane() {
    const list = loadSessions();
    if (!list.length) {
      historyPane.innerHTML = '<div class="history-empty">No agent chats yet.</div>';
      return;
    }
    historyPane.innerHTML = list.map((s) => `
      <div class="history-item ${state && state.id === s.id ? 'active' : ''}" data-id="${s.id}">
        <span class="h-title">${escapeHtml(s.title || 'Untitled task')}</span>
        <span class="h-meta">${relTime(s.updatedAt)}</span>
      </div>`).join('');
    historyPane.querySelectorAll('.history-item').forEach((el) => {
      el.addEventListener('click', () => loadSession(el.getAttribute('data-id')));
    });
  }

  // --- Chat bubble rendering ---

  function hideEmptyState() {
    if (emptyState) emptyState.style.display = 'none';
  }

  function clearThread() {
    chatThread.innerHTML = '';
    chatThread.appendChild(emptyState);
    emptyState.style.display = 'block';
  }

  function addUserBubble(text, save) {
    hideEmptyState();
    const row = document.createElement('div');
    row.className = 'chat-msg-row user';
    row.innerHTML = `<div class="chat-user-bubble">${escapeHtml(text)}</div>`;
    chatThread.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (save !== false && state) state.entries.push({ type: 'user', text });
    return row;
  }

  function addAssistantEntry(entry, save) {
    const kind = entry.kind, thought = entry.thought, html = entry.html;
    hideEmptyState();
    if (state) state.stepCount++;
    const row = document.createElement('div');
    row.className = 'chat-msg-row assistant';
    const wrap = document.createElement('div');
    wrap.className = 'chat-assistant-wrap';
    const card = document.createElement('div');
    card.className = `agent-step ${kind || 'plain'}`;
    card.innerHTML = `
      <div class="step-head"><span>${KIND_LABELS[kind] || 'Step'}${state ? ' · step ' + state.stepCount : ''}</span></div>
      ${thought ? `<div class="step-thought">${escapeHtml(thought)}</div>` : ''}
      ${html}
    `;
    wrap.appendChild(card);
    row.appendChild(wrap);
    chatThread.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (save !== false && state) state.entries.push({ type: 'assistant', kind: kind, thought: thought, html: html });
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

  async function pollVideo(jobId, attempt) {
    attempt = attempt || 0;
    const el = document.getElementById(domSafeId(jobId));
    if (!el) return;
    const MAX_ATTEMPTS = 40; // ~40 * 5s ≈ 3.3 minutes
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
        el.textContent = 'Still rendering after a few minutes — it may still finish, but this page stops checking here.';
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

  // --- Providers / tools ---

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
      bits.push(toolsData.webSearch ? 'Web search: on (DuckDuckGo, free)' : 'Web search: unavailable right now');
      bits.push(toolsData.imageGenProvider === 'zai' ? 'Image generation: on (Z.ai)' : 'Image generation: on (Pollinations, free)');
      bits.push(toolsData.videoGen ? 'Video generation: on (Z.ai)' : 'Video generation: off (set ZAI_API_KEY to enable)');
      bits.push('File uploads: on (any file type, incl. .zip)');
      bits.push('File writing: always on');
      toolStrip.textContent = bits.join(' · ');
    } catch (e) {
      toolStrip.textContent = 'Could not load agent configuration.';
      runBtn.disabled = true;
    }
  }

  // --- Attachments ---

  function renderChips() {
    if (!pendingFiles.length) { chipsEl.innerHTML = ''; return; }
    chipsEl.innerHTML = pendingFiles.map((f, i) => `
      <span class="attachment-chip">${escapeHtml(f.name)} (${(f.size / 1024).toFixed(0)} KB)<button type="button" data-i="${i}">✕</button></span>
    `).join('');
    chipsEl.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        pendingFiles.splice(Number(b.getAttribute('data-i')), 1);
        renderChips();
      });
    });
  }

  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const newFiles = Array.from(fileInput.files || []);
    const combined = [...pendingFiles, ...newFiles];
    const total = combined.reduce((s, f) => s + f.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      statusHint.textContent = `Attachments too large (${(total / 1024 / 1024).toFixed(1)} MB) — limit is ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)} MB total. Remove something and try again.`;
      fileInput.value = '';
      return;
    }
    pendingFiles = combined;
    fileInput.value = '';
    statusHint.textContent = '';
    renderChips();
  });

  function filesToAttachments(files) {
    return Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] || '';
        resolve({ filename: file.name, mimetype: file.type || 'application/octet-stream', base64: base64 });
      };
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    })));
  }

  // --- Agent loop ---

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
      addAssistantEntry({ kind: 'error', html: `<div class="step-body">Reached the ${MAX_STEPS}-step limit for this task. Start a new task to continue further.</div>` });
      finish('error');
      return;
    }
    statusHint.textContent = 'Working…';

    let result;
    try {
      const body = {
        providerId: state.providerId,
        task: state.transcript.length ? undefined : state.task,
        transcript: state.transcript
      };
      if (!state.attachmentsSent && pendingAttachments.length) {
        body.attachments = pendingAttachments;
      }
      result = await callAgent(body);
    } catch (err) {
      addAssistantEntry({ kind: 'error', html: `<div class="step-body">${escapeHtml(err.message)}</div>` });
      finish('error');
      return;
    }
    state.attachmentsSent = true;

    if (result.status === 'error') {
      addAssistantEntry({ kind: 'error', thought: result.thought, html: `<div class="step-body">${escapeHtml(result.error)}</div>` });
      finish('error');
      return;
    }

    if (result.status === 'retry') {
      state.transcript = result.transcript;
      stepLoop();
      return;
    }

    state.transcript = result.transcript;

    if (result.status === 'waiting_for_user') {
      addAssistantEntry({ kind: 'waiting', thought: result.thought, html: `<div class="step-body">${escapeHtml(result.question)}</div>` });
      statusHint.textContent = 'Waiting for your answer below.';
      answerRow.style.display = 'flex';
      answerInput.focus();
      finish('waiting_for_user');
      return;
    }

    if (result.status === 'done') {
      addAssistantEntry({ kind: 'final', thought: result.thought, html: `<div class="step-body final">${escapeHtml(result.answer)}</div>` });
      statusHint.textContent = 'Task complete.';
      finish('done');
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
    addAssistantEntry({ kind: result.error ? 'error' : (result.action || 'plain'), thought: result.thought, html: html });

    if (result.action === 'generate_video' && result.payload && result.payload.jobId) {
      pollVideo(result.payload.jobId);
    }

    persistSession();
    stepLoop();
  }

  function finish(status) {
    state.running = false;
    state.status = status;
    runBtn.disabled = false;
    resetBtn.style.display = 'inline-block';
    if (status !== 'waiting_for_user') answerRow.style.display = 'none';
    persistSession();
  }

  // --- Starting, answering, resetting, and reloading sessions ---

  function startNewSession(providerId, task) {
    state = {
      id: genId(), title: deriveTitle(task), createdAt: Date.now(), updatedAt: Date.now(),
      providerId: providerId, task: task, transcript: [], entries: [], stepCount: 0, running: false,
      attachmentsSent: false, status: 'continue'
    };
    pendingAttachments = [];
    clearThread();
    answerRow.style.display = 'none';
    resetBtn.style.display = 'none';
    renderHistoryPane();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const task = taskEl.value.trim();
    const providerId = providerSelect.value;
    if (!task || !providerId) return;

    const files = pendingFiles.slice();
    pendingFiles = [];
    renderChips();

    startNewSession(providerId, task);
    addUserBubble(task);
    if (files.length) {
      const lastBubble = chatThread.querySelector('.chat-msg-row.user:last-child .chat-user-bubble');
      if (lastBubble) lastBubble.insertAdjacentHTML('beforeend', `<div class="chat-attachment-note">📎 ${files.map((f) => escapeHtml(f.name)).join(', ')}</div>`);
    }

    taskEl.value = '';
    runBtn.disabled = true;
    statusHint.textContent = '';

    if (files.length) {
      try {
        pendingAttachments = await filesToAttachments(files);
      } catch (err) {
        statusHint.textContent = `Could not read attached files: ${err.message}`;
        finish('error');
        return;
      }
    }

    state.running = true;
    persistSession();
    stepLoop();
  });

  answerBtn.addEventListener('click', () => {
    const answer = answerInput.value.trim();
    if (!answer || !state) return;
    state.transcript = [...state.transcript, { role: 'user', content: answer }];
    addUserBubble(answer);
    answerInput.value = '';
    answerRow.style.display = 'none';
    state.running = true;
    runBtn.disabled = true;
    persistSession();
    stepLoop();
  });

  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') answerBtn.click();
  });

  function resetComposer() {
    taskEl.value = '';
    clearThread();
    answerRow.style.display = 'none';
    resetBtn.style.display = 'none';
    statusHint.textContent = '';
    pendingFiles = [];
    pendingAttachments = [];
    renderChips();
    state = null;
    renderHistoryPane();
  }

  resetBtn.addEventListener('click', resetComposer);

  function loadSession(id) {
    const list = loadSessions();
    const s = list.find((x) => x.id === id);
    if (!s) return;

    state = {
      id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
      providerId: s.providerId, task: s.task, transcript: s.transcript || [],
      entries: [], stepCount: 0, running: false, attachmentsSent: true, status: s.status
    };

    clearThread();
    (s.entries || []).forEach((entry) => {
      if (entry.type === 'user') addUserBubble(entry.text, false);
      else addAssistantEntry({ kind: entry.kind, thought: entry.thought, html: entry.html }, false);
    });
    state.entries = (s.entries || []).slice();
    state.stepCount = (s.entries || []).filter((e) => e.type === 'assistant').length;

    if (providerSelect.querySelector(`option[value="${s.providerId}"]`)) providerSelect.value = s.providerId;

    resetBtn.style.display = 'inline-block';
    if (s.status === 'waiting_for_user') {
      answerRow.style.display = 'flex';
      statusHint.textContent = 'Waiting for your answer below.';
    } else {
      answerRow.style.display = 'none';
      statusHint.textContent = s.status === 'done' ? 'Task complete.' : '';
    }
    renderHistoryPane();
  }

  window.AlmanacAgent = { newChat: resetComposer };

  loadProvidersAndTools();
  renderHistoryPane();
})();
