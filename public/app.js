(function () {
  const HISTORY_KEY = 'almanac:history';

  const providerStrip = document.getElementById('providerStrip');
  const form = document.getElementById('duelForm');
  const promptEl = document.getElementById('prompt');
  const beginBtn = document.getElementById('beginBtn');
  const newDuelBtn = document.getElementById('newDuelBtn');
  const statusHint = document.getElementById('statusHint');
  const arena = document.getElementById('arena');
  const voteBar = document.getElementById('voteBar');
  const bodyA = document.getElementById('bodyA');
  const bodyB = document.getElementById('bodyB');
  const revealA = document.getElementById('revealA');
  const revealB = document.getElementById('revealB');
  const stampA = document.getElementById('stampA');
  const stampB = document.getElementById('stampB');
  const ledgerBody = document.getElementById('ledgerBody');
  const matchCount = document.getElementById('matchCount');
  const historyList = document.getElementById('historyList');

  let AVAILABLE = [];
  let current = null; // { a, b, promptText, voted }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20))); }
    catch (e) { /* storage unavailable, ignore */ }
  }
  function renderHistory() {
    const hist = getHistory();
    if (!hist.length) {
      historyList.innerHTML = '<div class="hist-item muted">No duels yet — begin one above.</div>';
      return;
    }
    historyList.innerHTML = hist.map((h) =>
      `<div class="hist-item"><strong>${h.result}</strong> — ${h.a} vs ${h.b} — "${escapeHtml(h.prompt.slice(0, 70))}${h.prompt.length > 70 ? '…' : ''}"</div>`
    ).join('');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadProviders() {
    try {
      const res = await fetch('/api/providers');
      const data = await res.json();
      AVAILABLE = data.providers || [];
    } catch (e) {
      AVAILABLE = [];
    }
    if (AVAILABLE.length < 2) {
      providerStrip.innerHTML = '<span class="none">Fewer than two providers are configured on this deployment — add API keys as environment variables (see README) to start dueling.</span>';
      beginBtn.disabled = true;
    } else {
      providerStrip.textContent = `${AVAILABLE.length} scribes ready in the wings: ${AVAILABLE.map(p => p.name).join(' · ')}`;
    }
  }

  function pickDuel() {
    const shuffled = [...AVAILABLE].sort(() => Math.random() - 0.5);
    return { a: shuffled[0], b: shuffled[1] };
  }

  async function askScribe(providerId, promptText) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, prompt: promptText })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data.text || '(no response)';
  }

  async function renderLedger() {
    let ledger = {};
    try {
      const res = await fetch('/api/ledger');
      const data = await res.json();
      ledger = data.ledger || {};
    } catch (e) { /* keep empty */ }
    const rows = Object.values(ledger).sort((a, b) => b.rating - a.rating);
    const totalMatches = rows.reduce((s, r) => s + r.matches, 0) / 2;
    matchCount.textContent = rows.length ? ` · ${Math.max(0, Math.round(totalMatches))} duels judged` : '';
    if (!rows.length) {
      ledgerBody.innerHTML = '<tr><td colspan="5" class="muted">No duels judged yet — be the first to vote.</td></tr>';
      return;
    }
    ledgerBody.innerHTML = rows.map((r, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="name-cell">${r.name}</td>
        <td class="num">${Math.round(r.rating)}</td>
        <td class="num">${r.wins}-${r.losses}-${r.ties}</td>
        <td class="num">${r.matches}</td>
      </tr>`).join('');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (AVAILABLE.length < 2) return;
    const promptText = promptEl.value.trim();
    if (!promptText) return;

    const { a, b } = pickDuel();
    current = { a, b, promptText, voted: false };

    arena.style.display = 'grid';
    voteBar.style.display = 'flex';
    beginBtn.disabled = true;
    beginBtn.textContent = 'Duel in progress…';
    statusHint.textContent = '';
    revealA.textContent = ''; revealB.textContent = '';
    stampA.classList.remove('show'); stampB.classList.remove('show');
    bodyA.textContent = 'writing…'; bodyA.classList.add('loading');
    bodyB.textContent = 'writing…'; bodyB.classList.add('loading');
    document.querySelectorAll('.vote-btn').forEach((btn) => (btn.disabled = true));

    try {
      const [textA, textB] = await Promise.all([
        askScribe(a.id, promptText),
        askScribe(b.id, promptText)
      ]);
      bodyA.textContent = textA; bodyA.classList.remove('loading');
      bodyB.textContent = textB; bodyB.classList.remove('loading');
      document.querySelectorAll('.vote-btn').forEach((btn) => (btn.disabled = false));
      statusHint.textContent = 'Cast your vote below.';
    } catch (err) {
      bodyA.textContent = 'One or both scribes could not be reached: ' + (err.message || 'unknown error');
      bodyA.classList.remove('loading');
      bodyB.textContent = '';
      bodyB.classList.remove('loading');
      statusHint.textContent = 'Something went wrong — try again.';
    }
    beginBtn.disabled = false;
    beginBtn.textContent = 'Begin the Duel';
    newDuelBtn.style.display = 'inline-block';
  });

  newDuelBtn.addEventListener('click', () => {
    promptEl.value = '';
    arena.style.display = 'none';
    voteBar.style.display = 'none';
    newDuelBtn.style.display = 'none';
    statusHint.textContent = '';
    promptEl.focus();
  });

  document.querySelectorAll('.vote-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!current || current.voted) return;
      current.voted = true;
      document.querySelectorAll('.vote-btn').forEach((b) => (b.disabled = true));

      const vote = btn.getAttribute('data-vote');
      const apiResult = vote === 'A' ? 'A' : vote === 'B' ? 'B' : 'tie';

      let resultLabel;
      if (vote === 'A') resultLabel = current.a.name + ' won';
      else if (vote === 'B') resultLabel = current.b.name + ' won';
      else if (vote === 'tie') resultLabel = 'Tie';
      else resultLabel = 'Both dismissed';

      try {
        await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aId: current.a.id, bId: current.b.id, result: apiResult, prompt: current.promptText })
        });
      } catch (e) { /* ledger update best-effort */ }
      await renderLedger();

      revealA.textContent = current.a.name;
      revealB.textContent = current.b.name;
      stampA.textContent = vote === 'A' ? 'Chosen' : (vote === 'B' ? 'Passed' : 'Noted');
      stampB.textContent = vote === 'B' ? 'Chosen' : (vote === 'A' ? 'Passed' : 'Noted');
      stampA.classList.add('show');
      stampB.classList.add('show');
      statusHint.textContent = `Revealed: ${current.a.name} vs ${current.b.name}. ${resultLabel}.`;

      const hist = getHistory();
      hist.unshift({ a: current.a.name, b: current.b.name, prompt: current.promptText, result: resultLabel });
      saveHistory(hist);
      renderHistory();
    });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  loadProviders();
  renderLedger();
  renderHistory();
})();
