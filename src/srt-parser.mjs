export function timestampToMs(value) {
  const match = String(value)
    .trim()
    .match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/);

  if (!match) return null;

  const [, hours, minutes, seconds, milliseconds] = match;
  const paddedMilliseconds = milliseconds.padEnd(3, '0').slice(0, 3);

  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(paddedMilliseconds)
  );
}

function cleanSubtitleText(value) {
  return String(value)
    .replace(/^\uFEFF/, '')
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function parseSrt(rawText) {
  const normalized = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();

  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));

    if (timingIndex < 0) continue;

    const timingMatch = lines[timingIndex].match(
      /(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})/
    );

    if (!timingMatch) continue;

    const startMs = timestampToMs(timingMatch[1]);
    const endMs = timestampToMs(timingMatch[2]);
    const text = cleanSubtitleText(lines.slice(timingIndex + 1).join('\n'));

    if (startMs === null || endMs === null || endMs <= startMs || !text) continue;

    cues.push({
      id: cues.length + 1,
      startMs,
      endMs,
      text
    });
  }

  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function findActiveCue(cues, currentTimeMs) {
  if (!Array.isArray(cues) || cues.length === 0) return null;

  let low = 0;
  let high = cues.length - 1;
  let candidateIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (cues[middle].startMs <= currentTimeMs) {
      candidateIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (candidateIndex < 0) return null;

  for (let index = candidateIndex; index >= 0; index -= 1) {
    const cue = cues[index];
    if (cue.startMs > currentTimeMs) continue;
    if (cue.endMs >= currentTimeMs) return cue;

    if (currentTimeMs - cue.endMs > 5000) break;
  }

  return null;
}

export function formatMilliseconds(milliseconds) {
  const numericValue = Number(milliseconds);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const totalSeconds = Math.max(0, Math.floor(safeValue / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
