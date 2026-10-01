/** GETs a server-side proxy endpoint and unwraps its `{ warnings: [{ message }] }` error body into a thrown Error, matching how the other map feeds report failures. */
export async function fetchProxyJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.warnings?.[0]?.message ?? body?.error ?? `${label} failed: HTTP ${res.status}`);
  }
  return res.json();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
