// lib/tools/fileIngest.js
// Turns uploaded attachments into a text block the agent can read. No code
// execution happens here — zip files are only listed/read as inert data via
// adm-zip, never extracted to disk or run.
//
// Size limits exist because everything travels as base64 JSON through a
// serverless function (Netlify functions cap out around 6MB per request
// including all the JSON overhead) — see MAX_TOTAL_BYTES. The frontend
// enforces the same limit before upload so people get a clear error instead
// of a confusing failed request.

const AdmZip = require('adm-zip');

const MAX_TOTAL_BYTES = 3 * 1024 * 1024; // 3MB raw, pre-base64 (~4MB encoded — leaves headroom under Netlify's ~6MB payload ceiling)
const MAX_TEXT_CHARS_PER_FILE = 8000;
const MAX_ZIP_ENTRIES_LISTED = 200;
const MAX_ZIP_TEXT_FILES_INCLUDED = 5;
const MAX_ZIP_ENTRY_TEXT_CHARS = 2000;
const MAX_ZIP_ENTRY_TEXT_BYTES = 50 * 1024; // only inline text from small entries

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml', 'xml',
  'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java',
  'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'sh', 'bash', 'sql', 'ini', 'toml', 'env'
]);

function extOf(filename) {
  const parts = String(filename).split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function isTextExt(ext) {
  return TEXT_EXTENSIONS.has(ext);
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n… [truncated, ${str.length - max} more characters]`;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function describeZip(buffer, filename) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    return `--- File: ${filename} — could not be read as a zip archive (${e.message}) ---`;
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const lines = [`--- File: ${filename} (${entries.length} entries) — archive contents ---`];
  let textFilesIncluded = 0;

  entries.slice(0, MAX_ZIP_ENTRIES_LISTED).forEach((entry) => {
    const size = entry.header.size;
    const ext = extOf(entry.entryName);
    if (isTextExt(ext) && size <= MAX_ZIP_ENTRY_TEXT_BYTES && textFilesIncluded < MAX_ZIP_TEXT_FILES_INCLUDED) {
      textFilesIncluded++;
      let content = '';
      try {
        content = entry.getData().toString('utf8');
      } catch (e) {
        content = '[could not read entry contents]';
      }
      lines.push(`- ${entry.entryName} (${formatBytes(size)}):\n\`\`\`\n${truncate(content, MAX_ZIP_ENTRY_TEXT_CHARS)}\n\`\`\``);
    } else {
      lines.push(`- ${entry.entryName} (${formatBytes(size)})${isTextExt(ext) ? ' [text file, too large to include]' : ' [binary, not shown]'}`);
    }
  });

  if (entries.length > MAX_ZIP_ENTRIES_LISTED) {
    lines.push(`… and ${entries.length - MAX_ZIP_ENTRIES_LISTED} more entries not listed.`);
  }
  return lines.join('\n');
}

// attachments: [{ filename, mimetype, base64 }]
// Returns { text, totalBytes, error } — error is set (and text/totalBytes are
// still whatever could be produced) if the total size limit was exceeded.
function summarizeAttachments(attachments) {
  if (!attachments || !attachments.length) return { text: '', totalBytes: 0 };

  let totalBytes = 0;
  const blocks = [];

  for (const att of attachments) {
    let buffer;
    try {
      buffer = Buffer.from(att.base64, 'base64');
    } catch (e) {
      blocks.push(`--- File: ${att.filename} — could not be decoded ---`);
      continue;
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return {
        text: blocks.join('\n\n'),
        totalBytes,
        error: `Attachments exceed the ${formatBytes(MAX_TOTAL_BYTES)} total limit for this deployment. Try smaller or fewer files.`
      };
    }

    const ext = extOf(att.filename);
    if (ext === 'zip') {
      blocks.push(describeZip(buffer, att.filename));
    } else if (isTextExt(ext)) {
      const content = truncate(buffer.toString('utf8'), MAX_TEXT_CHARS_PER_FILE);
      blocks.push(`--- File: ${att.filename} (${formatBytes(buffer.length)}) ---\n\`\`\`\n${content}\n\`\`\``);
    } else {
      blocks.push(`--- File: ${att.filename} (${formatBytes(buffer.length)}, ${att.mimetype || 'unknown type'}) ---\n[binary file attached — contents are not directly readable in this build; ask the user to describe what's in it if you need specifics]`);
    }
  }

  const text = blocks.length
    ? `The user has attached the following file(s):\n\n${blocks.join('\n\n')}`
    : '';
  return { text, totalBytes };
}

module.exports = { summarizeAttachments, MAX_TOTAL_BYTES };
