export function hasTwoPartFormat(text: string): boolean {
  return (
    text.includes('=== EXECUTIVE SUMMARY ===') &&
    text.includes('=== DETAILED ANALYSIS ===')
  );
}

export function extractExecutiveSummary(text: string): string {
  const detailedStart = text.indexOf('=== DETAILED ANALYSIS ===');
  if (detailedStart > 0) {
    return text
      .substring(0, detailedStart)
      .replace('=== EXECUTIVE SUMMARY ===', '')
      .trim();
  }
  return text;
}

export function extractDetailedAnalysis(text: string): string {
  const detailedStart = text.indexOf('=== DETAILED ANALYSIS ===');
  if (detailedStart > 0) {
    return text
      .substring(detailedStart)
      .replace('=== DETAILED ANALYSIS ===', '')
      .trim();
  }
  return '';
}
