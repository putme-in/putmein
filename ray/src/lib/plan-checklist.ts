export function parsePlanChecklist(content: string) {
  let fenced = false;
  return content.split('\n').flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return []; }
    if (fenced) return [];
    const match = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]\s+(.+)$/);
    return match ? [{ id: `item-${index}`, text: match[2].trim(), completed: match[1].toLowerCase() === 'x' }] : [];
  });
}
