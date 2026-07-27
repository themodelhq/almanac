// lib/agent.js
// A deliberately simple ReAct-style loop: the model replies with one JSON
// action per turn, the backend executes exactly that one action, and the
// result is fed back as the next turn's context. One call to runAgentStep()
// == one step, so this stays well under Netlify's function time limit even
// though a whole task might take 5-10 steps end to end. The frontend drives
// the loop by calling again after each step until status is 'done' or
// 'waiting_for_user', or a max-step budget is hit.
//
// Deliberately NOT included: arbitrary shell/code execution. Running
// model-generated shell commands on a public, freely-deployable service is a
// real remote-code-execution risk for whoever hosts this, not just a policy
// nicety — so "write a file" is supported, "execute a file" is not.

const { askProviderMessages } = require('./providers');
const { webSearch, isAvailable: webSearchAvailable } = require('./tools/webSearch');
const { generateImage } = require('./tools/imageGen');
const { submitVideo, isAvailable: videoGenAvailable } = require('./tools/videoGen');
const { summarizeAttachments } = require('./tools/fileIngest');

const MAX_TOKENS = 1200;

function buildSystemPrompt() {
  const tools = [
    `- "generate_image": create an image. action_input is a detailed image description (string).`,
    `- "write_file": produce a deliverable file (code, an HTML page, a report, etc). action_input is an object: {"filename": "...", "content": "..."}.`,
    `- "ask_user": pause and ask the user a clarifying question before continuing. action_input is your question (string).`,
    `- "final_answer": the task is complete. action_input is your final response to the user (string), summarizing what was done and referencing any files, images, or videos you produced.`
  ];
  if (webSearchAvailable()) {
    tools.unshift(`- "web_search": look up current information you don't know. action_input is the search query (string).`);
  }
  if (videoGenAvailable()) {
    tools.splice(1, 0, `- "generate_video": create a short video clip. action_input is a detailed video description (string). Rendering happens in the background and can take a couple of minutes — after calling this, move on with the rest of the task rather than waiting or calling it again for the same request.`);
  }

  return `You are an autonomous task-completing agent inside "Almanac AI". You are given a task and must complete it yourself, using tools, across multiple steps — the user will not re-prompt you, so don't ask them to do the next step themselves unless you are genuinely blocked.

At EVERY turn, reply with ONLY a single JSON object and nothing else — no markdown code fences, no prose before or after it. The object must have exactly these keys:
{"thought": "brief reasoning about what to do next", "action": "one of the actions below", "action_input": <the input for that action>}

Available actions:
${tools.join('\n')}

Rules:
- Think step by step, but keep "thought" to one or two sentences.
- Prefer taking real action over asking the user something you could figure out yourself.
- When producing a deliverable (a webpage, a report, code), use "write_file" — put the ENTIRE file content in action_input.content.
- You have a limited number of steps. Once you have enough to complete the task, move to "final_answer" rather than continuing to search or refine indefinitely.
- Never invent search results or claim you used a tool you didn't actually call.`;
}

function stripFences(text) {
  return text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}

function safeParse(text) {
  try {
    return JSON.parse(stripFences(text));
  } catch (e) {
    return null;
  }
}

async function executeAction(action, actionInput) {
  if (action === 'web_search') {
    const results = await webSearch(String(actionInput));
    return { observation: `Observation from web_search("${actionInput}"): ${JSON.stringify(results)}`, payload: { tool: 'web_search', query: actionInput, results } };
  }
  if (action === 'generate_image') {
    const { dataUrl } = await generateImage(String(actionInput));
    return { observation: `Observation from generate_image: an image was generated successfully for the prompt "${actionInput}". Do not generate it again unless the user asks for a revision.`, payload: { tool: 'generate_image', prompt: actionInput, dataUrl } };
  }
  if (action === 'generate_video') {
    const { jobId } = await submitVideo(String(actionInput));
    return { observation: `Observation from generate_video: a video render was started for the prompt "${actionInput}" (job ${jobId}). It is rendering in the background and will appear to the user directly when ready — do not call this again for the same request, and do not wait for it before continuing.`, payload: { tool: 'generate_video', prompt: actionInput, jobId } };
  }
  if (action === 'write_file') {
    const filename = (actionInput && actionInput.filename) ? String(actionInput.filename) : 'output.txt';
    const content = (actionInput && typeof actionInput.content === 'string') ? actionInput.content : JSON.stringify(actionInput);
    return { observation: `Observation from write_file: file "${filename}" (${content.length} characters) has been saved and made available for the user to download.`, payload: { tool: 'write_file', filename, content } };
  }
  throw new Error(`Unknown action: ${action}`);
}

// transcript: array of { role: 'user' | 'assistant', content: string }
// attachments (only used when starting a fresh task): [{ filename, mimetype, base64 }]
async function runAgentStep({ providerId, task, transcript = [], attachments }) {
  let messages = transcript;

  if (!messages.length) {
    let taskText = task;
    if (attachments && attachments.length) {
      const { text, error } = summarizeAttachments(attachments);
      if (error) {
        return { status: 'error', transcript: [], error };
      }
      if (text) taskText = `${text}\n\n---\n\nThe user's task: ${task}`;
    }
    messages = [{ role: 'user', content: taskText }];
  }

  const system = buildSystemPrompt();

  let raw;
  try {
    raw = await askProviderMessages(providerId, system, messages, MAX_TOKENS);
  } catch (err) {
    return { status: 'error', transcript, error: err.message || 'Provider request failed' };
  }

  const nextTranscript = [...messages, { role: 'assistant', content: raw }];
  const parsed = safeParse(raw);

  if (!parsed || !parsed.action) {
    const corrected = [...nextTranscript, { role: 'user', content: 'Your last response was not a single valid JSON object. Reply again with ONLY the JSON object described in the instructions.' }];
    return { status: 'retry', transcript: corrected, raw };
  }

  const { thought, action, action_input } = parsed;

  if (action === 'ask_user') {
    return { status: 'waiting_for_user', transcript: nextTranscript, thought, question: String(action_input) };
  }

  if (action === 'final_answer') {
    return { status: 'done', transcript: nextTranscript, thought, answer: String(action_input) };
  }

  try {
    const { observation, payload } = await executeAction(action, action_input);
    const withObservation = [...nextTranscript, { role: 'user', content: observation }];
    return { status: 'continue', transcript: withObservation, thought, action, payload };
  } catch (err) {
    const withObservation = [...nextTranscript, { role: 'user', content: `Observation: the "${action}" action failed: ${err.message}. Try a different approach or ask the user for guidance.` }];
    return { status: 'continue', transcript: withObservation, thought, action, error: err.message };
  }
}

module.exports = { runAgentStep };
