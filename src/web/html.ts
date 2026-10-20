// Tiny HTML helpers: every dynamic value goes through esc().

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function money(v: number | null | undefined, currency?: string | null): string {
  if (v == null) return '–';
  const s = v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency && currency !== 'CAD' ? `${s} ${currency}` : `$${s}`;
}

export function when(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  return new Date(d).toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' });
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Catalog</title>
<style>
  :root { --fg:#1d2433; --muted:#5d6678; --line:#dde2ea; --bg:#f6f7f9; --card:#fff; --accent:#1f5fbf; --warn:#a15c00; --warnbg:#fff4e0; --bad:#b42318; --good:#1a7f37; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--fg); background:var(--bg); }
  header { background:#16213a; color:#fff; padding:10px 20px; display:flex; gap:24px; align-items:center; flex-wrap:wrap; }
  header a { color:#cfd8ea; text-decoration:none; } header a:hover, header a.on { color:#fff; }
  header .brand { font-weight:600; color:#fff; }
  main { padding:16px 20px; max-width:1400px; margin:0 auto; }
  h1 { font-size:20px; margin:4px 0 12px; } h2 { font-size:16px; margin:20px 0 8px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin-bottom:14px; }
  table { border-collapse:collapse; width:100%; background:var(--card); }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .muted { color:var(--muted); } .small { font-size:12px; }
  .tag { display:inline-block; padding:1px 6px; border-radius:10px; font-size:11px; background:#eef1f6; color:var(--muted); margin-right:4px; }
  .tag.warn { background:var(--warnbg); color:var(--warn); } .tag.bad { background:#fdecea; color:var(--bad); } .tag.good { background:#e7f5ec; color:var(--good); }
  form.filters { display:flex; flex-wrap:wrap; gap:10px; align-items:end; }
  form.filters label { display:flex; flex-direction:column; font-size:12px; color:var(--muted); gap:2px; }
  form.filters .break { flex-basis:100%; height:0; }
  input, select, button { font:inherit; padding:5px 8px; border:1px solid var(--line); border-radius:6px; background:#fff; }
  button { background:var(--accent); color:#fff; border-color:var(--accent); cursor:pointer; }
  button.secondary { background:#fff; color:var(--accent); }
  a { color:var(--accent); }
  .notice { padding:10px 12px; border-radius:6px; background:var(--warnbg); color:var(--warn); margin-bottom:12px; }
  .scroll { overflow-x:auto; }
  pre { white-space:pre-wrap; word-break:break-word; font-size:12px; background:#f3f5f8; padding:8px; border-radius:6px; max-height:400px; overflow:auto; }
  dl.kv { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:0; } dl.kv dt { color:var(--muted); }
</style></head>
<body><header><span class="brand">Product Catalog (internal)</span>
<a href="/">Search</a><a href="/updates">Updates</a><a href="/report">Data-quality report</a></header>
<main>${body}</main></body></html>`;
}

/** One line of key specs, e.g. "Core i5 (i5-1335U) · 16 GB memory · 512 GB SSD · 14" WUXGA · Windows 11 Pro". */
export function factsLine(f: Record<string, any> | null | undefined): string {
  if (!f) return '';
  const size = (gb: number) => (gb >= 1024 ? `${+(gb / 1024).toFixed(1)} TB` : `${gb} GB`);
  const parts = [
    f.processorLine ? `${f.processorLine}${f.processorModel ? ` (${f.processorModel})` : ''}` : null,
    f.memoryGb ? `${f.memoryGb} GB memory` : null,
    f.storageGb ? `${size(f.storageGb)} ${f.storageType ?? 'storage'}` : null,
    f.screenInches ? `${f.screenInches}"${f.resolution ? ` ${f.resolution}` : ''}` : f.resolution ?? null,
    f.refreshHz ? `${f.refreshHz} Hz` : null,
    f.panel ?? null,
    f.usbC ? 'USB-C' : null,
    f.graphics ?? null,
    f.formFactor ?? null,
    f.dockConnection ?? null,
    f.powerW ? `${f.powerW} W` : null,
    f.os ?? null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Plain-language names for the key-spec fields, for the product page. */
export const FACT_LABELS: Record<string, string> = {
  processorLine: 'Processor', processorModel: 'Processor model', processorTier: 'Processor level', memoryGb: 'Memory (GB)',
  storageGb: 'Storage (GB)', storageType: 'Storage type', screenInches: 'Screen size (inches)', resolution: 'Resolution',
  os: 'Operating system', graphics: 'Graphics', dedicatedGraphics: 'Dedicated graphics', formFactor: 'Form factor',
  refreshHz: 'Refresh rate (Hz)', panel: 'Panel', usbC: 'USB-C', dockConnection: 'Connection', powerW: 'Power (W)', processorBrand: 'Processor maker',
};

