export function tokenizeEnglishText(input) {
  const text = String(input || '');
  const segments = [];
  const wordTokens = [];
  const pattern = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|\s+|[^\p{L}\p{M}\p{N}\s]+/gu;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    const isWord = /[\p{L}\p{N}]/u.test(value) && !/^\s+$/u.test(value);
    const segment = {
      text: value,
      start: match.index,
      end: match.index + value.length,
      isWord,
      tokenIndex: null
    };

    if (isWord) {
      segment.tokenIndex = wordTokens.length;
      wordTokens.push({
        index: segment.tokenIndex,
        text: value,
        start: segment.start,
        end: segment.end
      });
    }

    segments.push(segment);
  }

  return { text, segments, wordTokens };
}

export function sourceTextForTokenSpan(text, wordTokens, startToken, endToken) {
  if (!Array.isArray(wordTokens) || wordTokens.length === 0) return '';
  const start = wordTokens[startToken];
  const end = wordTokens[endToken];
  if (!start || !end || startToken > endToken) return '';
  return String(text || '').slice(start.start, end.end).trim();
}
