/**
 * Backend base URL for production splits (Vercel web → Render API).
 * Empty in local dev so Vite's proxy keeps `/api` and `/socket.io` same-origin.
 */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (!raw) return '';
  return raw.replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}
