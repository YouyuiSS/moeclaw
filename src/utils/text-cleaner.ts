/**
 * Removes markdown syntax from text to improve TTS pronunciation.
 * e.g., "**Hello**" -> "Hello"
 */
export function cleanTextForTts(text: string): string {
  if (!text) return "";

  let clean = text;

  // Remove bold/italic markers (* or _)
  // We need to be careful not to remove * in math expressions, but for chat logic usually it's fine.
  // Aggressive approach: remove all non-escaped * and _ if they look like wrappers.
  // Simpler approach: remove all ** and __ first, then * and _?

  // Remove bold (** or __)
  clean = clean.replace(/(\*\*|__)(.*?)\1/g, "$2");

  // Remove italic (* or _)
  clean = clean.replace(/(\*|_)(.*?)\1/g, "$2");

  // Remove links: [text](url) -> text
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove inline code: `text` -> text
  clean = clean.replace(/`([^`]+)`/g, "$1");

  // Remove code blocks: ```\n ... \n``` -> ... (content might be code, but usually better than saying "backtick backtick backtick")
  // For code blocks, we might want to just skip them or say "code block"?
  // For now, let's just strip the fences.
  clean = clean.replace(/```[\s\S]*?```/g, (match) => {
    // Extract content inside
    return match.replace(/```/g, "").trim();
  });

  // Remove headers: # Header -> Header
  clean = clean.replace(/^#+\s+/gm, "");

  // Remove blockquotes: > Text -> Text
  clean = clean.replace(/^>\s+/gm, "");

  // Remove images: ![alt](url) -> "" (or maybe alt text?)
  // Text to speech shouldn't read image urls.
  clean = clean.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

  // Remove emojis and symbols
  // The range includes:
  // - Standard emojis: \u{1F300}-\u{1F9FF}
  // - Geometric Shapes, Dingbats: \u{2000}-\u{3300} (roughly)
  // - Misc Symbols: \u{2600}-\u{27BF}
  // A simpler regex for most emojis is /[\u{1F300}-\u{1F9FF}]/u
  // But we also want to catch things like ⚠️, ✨, etc. which are in lower ranges.
  // Using a broad unicode property escape for Emoji if finding it supported, or a range block.
  // Range block approach:
  clean = clean.replace(
    /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
    "",
  );

  return clean.trim();
}
