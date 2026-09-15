/** Preserve editable campaign criteria while displaying them as notice prose. */
export function exclusionParagraphs(items: readonly string[]): string[] {
  const explanations: string[] = [];
  const criteria = items.map((item) => {
    // The arena explanation is on a separate parenthesized line in the existing CMS.
    const parts = item.split(/\n\s*\(/);
    if (parts.length > 1) explanations.push(parts.slice(1).join('(').replace(/\)\s*$/, '').trim());
    return parts[0]!.trim().replace(/[.。]$/, '');
  }).filter(Boolean);
  if (criteria.length === 0) return [];
  return [`${criteria.join(', ')}는 선정에서 제외될 수 있습니다.`, ...explanations];
}
