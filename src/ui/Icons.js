/**
 * Icons.js — inline SVG icon set.
 * Icons are registered as CSS mask images so they inherit the current text
 * colour ([data-icon] + .ico). No icon font, no extra requests.
 */
export const ICONS = {
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  target: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" fill="none"/>',
  credit: '<ellipse cx="12" cy="7" rx="8" ry="3.2"/><path d="M4 7v5c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 12v5c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-5" fill="none" stroke="currentColor" stroke-width="2"/>',
  star: '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8 2l2.2 6M16 2l-2.2 6" stroke="currentColor" stroke-width="2.4" fill="none"/>',
  warn: '<path d="M12 3l9.5 17H2.5z"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#071726"/><circle cx="12" cy="17.4" r="1.2" fill="#071726"/>',
  mentor: '<circle cx="12" cy="8.5" r="4.2"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/>',
  map: '<path d="M9 3l6 2.4L21 3v15.6L15 21l-6-2.4L3 21V5.4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 3v15.6M15 5.4V21" stroke="currentColor" stroke-width="2" fill="none"/>',
  sound: '<path d="M4 9h3.2L12 5v14l-4.8-4H4z"/><path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2"/>',
  mute: '<path d="M4 9h3.2L12 5v14l-4.8-4H4z"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" fill="none"/>',
  help: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.2 9.4a2.9 2.9 0 115.1 1.9c-.8.9-2.3 1.3-2.3 2.7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17.3" r="1.2"/>',
  gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5l1.4 2.6 2.9-.6.6 2.9 2.6 1.4-1.5 2.6 1.5 2.6-2.6 1.4-.6 2.9-2.9-.6L12 21.5l-1.4-2.6-2.9.6-.6-2.9-2.6-1.4L6 12.6 4.5 10l2.6-1.4.6-2.9 2.9.6z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  book: '<path d="M4 4.5h6a3 3 0 013 3V21a3 3 0 00-3-3H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 4.5h-6a3 3 0 00-3 3V21a3 3 0 013-3h6z" fill="none" stroke="currentColor" stroke-width="2"/>',
  cube: '<path d="M12 2.6l8.4 4.3v9.5L12 21.4 3.6 16.4V6.9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.6 6.9L12 11.2l8.4-4.3M12 11.2V21.4" fill="none" stroke="currentColor" stroke-width="2"/>',
  route: '<circle cx="6" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.6 6H15a3 3 0 013 3v6.4" fill="none" stroke="currentColor" stroke-width="2"/>',
  cap: '<path d="M2 8.5L12 4l10 4.5-10 4.5z"/><path d="M6 11v4.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V11" fill="none" stroke="currentColor" stroke-width="2"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.6-5.9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M20 3v5h-5" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  exit: '<path d="M14 4H6a2 2 0 00-2 2v12a2 2 0 002 2h8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M17 8l4 4-4 4M21 12H10" fill="none" stroke="currentColor" stroke-width="2"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" fill="none"/>',
  up: '<path d="M12 5l7 8h-4.5v6h-5v-6H5z"/>',
  down: '<path d="M12 19l-7-8h4.5V5h5v6H19z"/>',
  left: '<path d="M5 12l8-7v4.5h6v5h-6V19z"/>',
  right: '<path d="M19 12l-8 7v-4.5H5v-5h6V5z"/>',
  horn: '<path d="M4 10v4l9 5V5z"/><path d="M15 8a5.5 5.5 0 010 8M18 5.5a9 9 0 010 13" fill="none" stroke="currentColor" stroke-width="2"/>',
  hook: '<path d="M12 3v8" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="M12 11a4 4 0 104 4" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="3" r="1.6"/>',
  spreader: '<rect x="3" y="9" width="18" height="3.4" rx="1"/><rect x="5" y="15" width="3" height="3" rx="1"/><rect x="16" y="15" width="3" height="3" rx="1"/>',
  machines: '<rect x="2" y="13" width="9" height="6" rx="1.4"/><path d="M11 16h3l3-4h3v4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="5.5" cy="20.5" r="1.8"/><circle cx="17" cy="20.5" r="1.8"/>',
  ship: '<path d="M3 14h18l-2.4 5.4H5.4z"/><path d="M6 14V7h7l4 7" fill="none" stroke="currentColor" stroke-width="2"/>',
  warehouse: '<path d="M2 20V9l10-5 10 5v11z"/><rect x="7" y="13" width="10" height="7" fill="#071726"/>',
  truck: '<rect x="2" y="8" width="12" height="8" rx="1.2"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>',
  wrench: '<path d="M15.6 3a5.4 5.4 0 00-5 7.4L3 18l3 3 7.6-7.6A5.4 5.4 0 1021 8.4l-3.4 2.2-2.2-2.2L17.6 5z"/>',
  shield: '<path d="M12 2.5l8 3v7c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5v-7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.6 12.2l2.5 2.5 4.4-4.8" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  pallet: '<rect x="3" y="7" width="18" height="7" rx="1"/><rect x="3" y="16" width="18" height="2.4"/><rect x="5" y="18.4" width="2.4" height="3"/><rect x="16.6" y="18.4" width="2.4" height="3"/>',
  crate: '<rect x="3" y="3" width="18" height="18" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 3l18 18M21 3L3 21" stroke="currentColor" stroke-width="1.6"/>',
  drum: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" fill="none" stroke="currentColor" stroke-width="2"/>',
  clock: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5.4l3.4 2" fill="none" stroke="currentColor" stroke-width="2"/>',
  rotate: '<path d="M4 8h9a4 4 0 010 8H9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 4L3 8l4 4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 018 0V10" fill="none" stroke="currentColor" stroke-width="2"/>',
  check: '<path d="M5 13l4.5 4.5L19 6.5" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  x: '<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" fill="none"/>'
};

/** Build a data-URI mask for an icon. */
export function iconDataUri(name, color = '#ffffff') {
  const body = ICONS[name] || ICONS.help;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Apply masks to every [data-icon] element (called once at boot). */
export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    const uri = iconDataUri(name);
    el.style.webkitMaskImage = uri;
    el.style.maskImage = uri;
    el.style.webkitMaskRepeat = 'no-repeat';
    el.style.maskRepeat = 'no-repeat';
    el.style.webkitMaskPosition = 'center';
    el.style.maskPosition = 'center';
    el.style.webkitMaskSize = 'contain';
    el.style.maskSize = 'contain';
  });
}

/** Create an icon element programmatically. */
export function iconEl(name, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('data-icon', name);
  const uri = iconDataUri(name);
  span.style.webkitMaskImage = uri;
  span.style.maskImage = uri;
  span.style.webkitMaskRepeat = 'no-repeat';
  span.style.maskRepeat = 'no-repeat';
  span.style.webkitMaskPosition = 'center';
  span.style.maskPosition = 'center';
  span.style.webkitMaskSize = 'contain';
  span.style.maskSize = 'contain';
  return span;
}

export default ICONS;
