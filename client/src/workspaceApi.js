const prefix = '/api/v3';

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload == null) {
    throw new Error(payload?.error || payload?.message || `The server returned HTTP ${response.status}.`);
  }

  return payload;
}

export function getResource(resource, sessionId, signal) {
  return jsonRequest(`${prefix}/${resource}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { signal });
}

export function getHealth(signal) {
  return jsonRequest('/api/health', { signal });
}

export function postAction(resource, sessionId, options = {}) {
  return jsonRequest(`${prefix}/${resource}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...options }),
  });
}

export function resetSession(sessionId) {
  return jsonRequest(`${prefix}/session?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function exportSession(sessionId) {
  const data = await getResource('export', sessionId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.href = url;
  element.download = 'turntrace-workspace.json';
  element.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function getSessionId() {
  const key = 'turntrace2.sessionId';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const sessionId = `workspace_${crypto.randomUUID()}`;
    sessionStorage.setItem(key, sessionId);
    return sessionId;
  } catch {
    return `workspace_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}
