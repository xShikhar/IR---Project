import React from 'react';

const icons = {
  trace: <><circle cx="5" cy="17" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19" cy="14" r="2"/><path d="m6.2 15.3 4.6-6.6m2.7-.2 4 4M5 21h14"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
  compare: <path d="M8 5H4v14h4m8-14h4v14h-4M9 9h6m-3-3 3 3-3 3m3 3H9m3-3-3 3 3 3"/>,
  chart: <path d="M4 4v16h16M8 15v-3m4 3V8m4 7V5"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  topic: <><path d="M4 8a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 14h7"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  arrowUp: <path d="M12 20V4m-6 6 6-6 6 6"/>,
  arrowUpRight: <path d="M6 18 18 6M7 6h11v11"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  layers: <path d="m12 4 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4"/>,
  undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h10a5 5 0 0 1 5 5v1"/></>,
  download: <path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/>,
  reset: <path d="M4 11a8 8 0 1 1 2 6M4 5v6h6"/>,
  panel: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M15 5v14"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  orbit: <><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-40 12 12)"/><circle cx="12" cy="12" r="2"/><path d="M5 5h.01M19 19h.01"/></>,
  branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-9v.5a5.5 5.5 0 0 1-5.5 5.5H6"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/></>,
  bolt: <path d="m13 2-8 12h6l-1 8 9-12h-6l1-8Z"/>,
  sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6m-6 0v6"/></>,
  sparkle: <><path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10C11 16 8 13 2 12c6-1 9-4 10-10Z"/><path d="M20 3v4m-2-2h4"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  relevant: <path d="M8 10v10H4V10zm0 1 4-7c1-2 3-.5 2.5 1.5L14 9h4a2 2 0 0 1 2 2.4l-1.2 6a2 2 0 0 1-2 1.6H8"/>,
  irrelevant: <path d="M8 14V4H4v10zm0-1 4 7c1 2 3 .5 2.5-1.5L14 15h4a2 2 0 0 0 2-2.4l-1.2-6a2 2 0 0 0-2-1.6H8"/>,
  pin: <path d="m9 4 11 4-3 2-1 5 1 2-9-3 2-2 2-5zM8 14l-4 6"/>,
  file: <path d="M7 3h8l4 4v14H5V3zM14 3v5h5M8 12h8m-8 4h6"/>,
  clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  question: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/></>,
  bookmark: <path d="M6 4h12v16l-6-4-6 4z"/>,
  next: <path d="m5 6 7 6-7 6V6Zm8 0 7 6-7 6V6Z"/>,
};

export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

export const domainNames = {
  cs_ai: 'Computing & AI',
  space_physics: 'Space & physics',
  history_civilization: 'History & civilization',
  biology_medicine: 'Biology & medicine',
};

export const modelNames = { hybrid: 'Hybrid', bm25: 'BM25', cosine: 'SMART cosine', semantic: 'Semantic' };

export function label(value) {
  return String(value ?? '').replace(/[_-]/g, ' ').replace(/^\w/, first => first.toUpperCase());
}

export function numeric(value, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function Empty({ icon = 'search', title, children, className = '' }) {
  return (
    <div className={`empty-state ${className}`}>
      <span className="empty-icon"><Icon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Status({ children, kind = 'info' }) {
  return (
    <div className={`status-box ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' ? <span className="spinner" /> : <Icon name={kind === 'error' ? 'alert' : 'info'} size={17} />}
      <div>{children}</div>
    </div>
  );
}
