export type UrlType = 'web' | 'file' | 'unknown';

export function classifyUrl(url: string): UrlType {
  if (!url) return 'unknown';

  const lower = url.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'web';
  if (lower.startsWith('file://')) return 'file';
  return 'unknown';
}

export function openUrl(url: string): void {
  const type = classifyUrl(url);

  if (type === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else if (type === 'file') {
    try {
      logseq.App.openExternalLink(url);
    } catch (err) {
      console.error('Failed to open file URL:', err);
    }
  }
  // unknown: no-op
}
