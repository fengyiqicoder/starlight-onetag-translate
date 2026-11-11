// Shared helpers for the starlight-onetag-* plugins. Copied into each package so every
// plugin installs on its own.

const ERRORS = {
	no_key: 'AI is not set up on this site yet: the site owner needs to add a OneTag AI key.',
	bad_key: 'AI is not set up correctly on this site: its OneTag AI key is not valid.',
	domain_not_allowed: 'This site is not allowed to use its OneTag AI key.',
	quota_exceeded: 'This site has used up its AI allowance for now.',
	paused: 'The AI service is paused for today. Try again after 00:00 UTC.',
	rate_limited: 'Too many requests in one minute. Give it a moment.',
	too_large: 'That is too long to send in one request.',
	network: 'Could not reach the AI service. Check your connection and try again.',
	upstream: 'The AI provider had a problem. Try again in a few seconds.',
	aborted: 'Stopped.',
};

export function errorText(e) {
	return ERRORS[e?.code] || (e?.code && e.message) || 'Could not load the AI service. Check your connection and try again.';
}

export function isLocal() {
	return /^(|localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(location.hostname);
}

// The onetagai SDK is its own chunk, fetched the first time a reader uses the feature.
let sdkPromise = null;
export function loadSdk(site) {
	if (!sdkPromise) {
		sdkPromise = import('onetagai').then((sdk) => {
			if (site && site !== 'https://onetagai.com') sdk.configure({ endpoint: site.replace(/\/$/, '') + '/v1/ask' });
			return sdk;
		});
		sdkPromise.catch(() => (sdkPromise = null));
	}
	return sdkPromise;
}

export function contentRoot() {
	return document.querySelector('.sl-markdown-content');
}

export function pageTitle() {
	return document.querySelector('h1#_top')?.textContent?.trim() || document.title;
}

// Text of the docs content without code-copy buttons or our own UI.
export function pageText(max = 24000) {
	const root = contentRoot();
	if (!root) return '';
	const clone = root.cloneNode(true);
	clone.querySelectorAll('[data-onetag-ui], .copy, script, style, svg').forEach((n) => n.remove());
	return (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export function addStyle(id, css) {
	if (document.getElementById(id)) return;
	const s = document.createElement('style');
	s.id = id;
	s.textContent = css;
	document.head.append(s);
}

export function el(tag, attrs = {}, ...children) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === false || v == null) continue;
		if (k === 'class') n.className = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v === true ? '' : v);
	}
	n.append(...children.filter((c) => c != null));
	return n;
}

// A small, safe renderer for model answers: paragraphs, "- " lists, `code` and **bold**.
// Everything goes in as text nodes; nothing the model writes is parsed as HTML.
function inline(text) {
	const out = [];
	text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).forEach((part) => {
		if (!part) return;
		if (part.startsWith('`') && part.endsWith('`') && part.length > 2) out.push(el('code', {}, part.slice(1, -1)));
		else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push(el('strong', {}, part.slice(2, -2)));
		else out.push(document.createTextNode(part));
	});
	return out;
}
export function render(target, text) {
	const nodes = [];
	let list = null;
	text.replace(/\r/g, '').split('\n').forEach((line) => {
		const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
		if (item) {
			if (!list) nodes.push((list = el('ul')));
			list.append(el('li', {}, ...inline(item[1])));
			return;
		}
		list = null;
		const t = line.replace(/^#+\s*/, '').trim();
		if (t) nodes.push(el('p', {}, ...inline(t)));
	});
	target.replaceChildren(...nodes);
}

// Ask the model and stream into a target element. Returns the full text.
export async function stream(cfg, prompt, input, target, opts = {}) {
	const sdk = await loadSdk(cfg.site);
	let shown = '';
	const text = await sdk.ask(prompt, input, {
		key: cfg.key || undefined,
		via: cfg.via,
		system: opts.system,
		history: opts.history,
		maxTokens: opts.maxTokens || cfg.maxTokens,
		signal: opts.signal,
		stream: target
			? (d) => {
					shown += d;
					render(target, shown);
					opts.onDelta?.();
				}
			: undefined,
	});
	if (target) render(target, text);
	return text;
}

// The language readers see answers in: the option, else the page's own language.
export function answerLanguage(cfg) {
	if (cfg.lang) return cfg.lang;
	const code = document.documentElement.lang || 'en';
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
	} catch {
		return code;
	}
}

export function store(key, value) {
	try {
		if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
	return null;
}

export function hash(s) {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

// Shown once per page to the site owner on localhost when no key is set.
export function demoNote(cfg) {
	if (cfg.key || !isLocal()) return null;
	return el('p', { class: 'onetag-note' }, 'No key set: on localhost the answers come from a shared demo key. Add your own free OneTag AI key before you deploy.');
}

export const BASE_CSS = `
[data-onetag-ui] { font-size: var(--sl-text-sm); }
[data-onetag-ui] [hidden], [data-onetag-ui][hidden] { display: none !important; }
[data-onetag-ui] p { margin: 0 0 .5em; }
[data-onetag-ui] p:last-child { margin-bottom: 0; }
[data-onetag-ui] ul { margin: 0 0 .5em; padding-inline-start: 1.2em; }
[data-onetag-ui] code { font-size: .9em; }
.onetag-btn { display: inline-flex; align-items: center; gap: .35rem; font: inherit; font-size: var(--sl-text-sm); padding: .25rem .6rem; border: 1px solid var(--sl-color-gray-5); border-radius: .4rem; background: var(--sl-color-gray-6); color: var(--sl-color-text); cursor: pointer; line-height: 1.5; }
.onetag-btn:hover { border-color: var(--sl-color-accent); color: var(--sl-color-white); }
.onetag-btn:focus-visible { outline: 2px solid var(--sl-color-accent); outline-offset: 2px; }
.onetag-btn[disabled] { opacity: .6; cursor: wait; }
.onetag-link { border: 0; background: none; padding: 0; font: inherit; color: var(--sl-color-text-accent); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.onetag-status { color: var(--sl-color-gray-3); }
.onetag-status.error { color: var(--sl-color-red-high, #f87171); }
.onetag-note { color: var(--sl-color-gray-3); font-size: var(--sl-text-xs); }
.onetag-foot { color: var(--sl-color-gray-3); font-size: var(--sl-text-xs); margin-top: .5em; }
.onetag-panel { margin-top: .75rem; padding: .75rem 1rem; border: 1px solid var(--sl-color-gray-5); border-inline-start: 3px solid var(--sl-color-accent); border-radius: .4rem; background: var(--sl-color-gray-6); }
`;
