// Browser side of starlight-onetag-translate.
import { addStyle, BASE_CSS, contentRoot, el, errorText, hash, isLocal, loadSdk, store, demoNote } from './shared.js';

// Chrome's built-in Translator API: on-device, free, no key. Codes follow its naming.
function browserCode(c) {
	c = String(c || '').toLowerCase();
	if (/^zh-(tw|hk|mo|hant)/.test(c)) return 'zh-Hant';
	return c.split('-')[0];
}
async function browserTranslator(from, to) {
	if (!('Translator' in self)) return null;
	try {
		const opts = { sourceLanguage: browserCode(from), targetLanguage: browserCode(to) };
		const a = await self.Translator.availability(opts);
		if (a === 'unavailable') return null;
		return await self.Translator.create(opts);
	} catch {
		return null;
	}
}

const SKIP = 'pre, code, kbd, samp, script, style, svg, .expressive-code, [translate="no"], .notranslate, [data-onetag-ui], .sl-anchor-link';
const PREF = 'starlight-onetag-translate:lang';

function name(code, inLang) {
	try {
		return new Intl.DisplayNames([inLang || code], { type: 'language' }).of(code) || code;
	} catch {
		return code;
	}
}
const base = (c) => String(c || '').toLowerCase().split('-')[0];
const same = (a, b) => {
	a = String(a || '').toLowerCase();
	b = String(b || '').toLowerCase();
	if (base(a) !== base(b)) return false;
	// Simplified and Traditional Chinese count as different languages.
	const trad = (c) => /zh-(tw|hk|mo|hant)/.test(c);
	return base(a) !== 'zh' || trad(a) === trad(b);
};

// Text nodes worth translating, in reading order: the page title and the docs content.
function collect() {
	const roots = [document.querySelector('h1#_top'), contentRoot()].filter(Boolean);
	const nodes = [];
	for (const root of roots) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
		});
		while (walker.nextNode()) nodes.push(walker.currentNode);
	}
	return nodes;
}

function batches(texts, size) {
	const out = [];
	let cur = [];
	let len = 0;
	texts.forEach((t, i) => {
		if (cur.length && len + t.length > size) {
			out.push(cur);
			cur = [];
			len = 0;
		}
		cur.push(i);
		len += t.length + 6;
	});
	if (cur.length) out.push(cur);
	return out;
}

const SYSTEM =
	'You translate documentation for readers. Translate each numbered segment into the target language. ' +
	'Segments are fragments of one page in reading order and may break mid-sentence: translate each fragment so that, read in order, the page reads naturally. ' +
	'Translate every segment, including short fragments such as a single word or "Push to". Keep code identifiers, commands, file names, URLs, product names and placeholders unchanged. ' +
	'Output one line per segment, starting with its marker, for example «3» text. Same count, same order, nothing else.';

export default function init(cfg) {
	const h1 = document.querySelector('h1#_top');
	if (!h1 || !contentRoot()) return;
	addStyle('starlight-onetag-translate', BASE_CSS + CSS);

	const pageLang = document.documentElement.lang || 'en';
	const reader = navigator.language && !same(navigator.language, pageLang) ? navigator.language : null;
	const langs = [...new Set(cfg.languages.filter((l) => !same(l, pageLang)))];
	if (reader && !langs.some((l) => same(l, reader))) langs.unshift(reader);

	let nodes = null;
	let originals = null;
	let controller = null;
	let current = null;

	const status = el('span', { class: 'onetag-status', 'aria-live': 'polite' });
	const select = el('select', { 'aria-label': 'Translate this page into' },
		el('option', { value: '' }, 'Translate…'),
		...langs.map((l) => el('option', { value: l }, name(l)))
	);
	const quick = reader ? el('button', { type: 'button', class: 'onetag-btn', onclick: () => translate(reader) }, globe(), 'Read in ' + name(reader)) : null;
	const original = el('button', { type: 'button', class: 'onetag-link', hidden: true, onclick: () => restore(true) }, 'Show original');
	// The demo-key note only matters when the browser cannot translate on its own.
	const note = 'Translator' in self ? null : demoNote(cfg);
	const bar = el('div', { class: 'onetag-translate', 'data-onetag-ui': '' }, quick, select, status, original);
	h1.after(bar);
	if (note) bar.after(note), note.setAttribute('data-onetag-ui', '');

	select.addEventListener('change', () => select.value && translate(select.value));

	function restore(forget) {
		if (controller) controller.abort();
		if (nodes && originals) nodes.forEach((n, i) => (n.nodeValue = originals[i]));
		current = null;
		original.hidden = true;
		status.textContent = '';
		status.classList.remove('error');
		select.value = '';
		if (quick) quick.hidden = false;
		if (forget) store(PREF, '');
	}

	async function translate(lang) {
		if (current === lang) return;
		if (current) restore(false);
		if (controller) controller.abort();
		controller = new AbortController();
		const { signal } = controller;
		nodes = nodes || collect();
		originals = originals || nodes.map((n) => n.nodeValue);
		const texts = originals.map((t) => t.replace(/\s+/g, ' ').trim());
		current = lang;
		if (cfg.remember) store(PREF, lang);
		select.value = lang;
		if (quick) quick.hidden = true;
		status.classList.remove('error');
		const cacheKey = 'starlight-onetag-translate:' + location.pathname + ':' + lang + ':' + hash(texts.join('\n'));
		const cached = cfg.cache ? store(cacheKey) : null;
		const result = Array.isArray(cached) && cached.length === texts.length ? cached : new Array(texts.length).fill(null);
		const apply = () =>
			result.forEach((t, i) => {
				if (t == null) return;
				const lead = originals[i].match(/^\s*/)[0];
				const trail = originals[i].match(/\s*$/)[0];
				nodes[i].nodeValue = lead + t + trail;
			});
		apply();
		const todo = batches(texts, cfg.batchChars).filter((b) => b.some((i) => result[i] == null));
		try {
			// Without a key, use the reader's browser when it can translate on its own.
			const local = cfg.engine === 'browser' || (cfg.engine !== 'onetag' && !cfg.key);
			const tr = local && todo.length ? await browserTranslator(pageLang, lang) : null;
			if (tr) {
				const ids = todo.flat();
				let done = 0;
				const work = async () => {
					while (ids.length) {
						const i = ids.shift();
						result[i] = await tr.translate(texts[i]);
						if (signal.aborted) return;
						nodes[i].nodeValue = originals[i].match(/^\s*/)[0] + result[i] + originals[i].match(/\s*$/)[0];
						if (++done % 20 === 0) status.textContent = `Translating ${Math.round((done / texts.length) * 100)}%…`;
					}
				};
				status.textContent = 'Translating in your browser…';
				await Promise.all([work(), work(), work(), work()]);
				if (signal.aborted) return;
				status.textContent = 'Translated in your browser.';
				original.hidden = false;
				if (cfg.cache) store(cacheKey, result.map((t, i) => t ?? texts[i]));
				return;
			}
			if (!cfg.key && !isLocal() && cfg.engine !== 'onetag')
				throw Object.assign(new Error('Translation works in a recent Chrome. In other browsers the site owner can add a free OneTag AI key.'), { code: 'no_browser' });
			if (cfg.engine === 'browser') throw Object.assign(new Error('This browser cannot translate pages on its own. Try a recent Chrome.'), { code: 'no_browser' });
			const sdk = todo.length ? await loadSdk(cfg.site) : null;
			for (let k = 0; k < todo.length; k++) {
				status.textContent = `Translating ${k + 1}/${todo.length}…`;
				const ids = todo[k];
				const input = ids.map((i, j) => `«${j + 1}» ${texts[i]}`).join('\n');
				const text = await sdk.ask(`Target language: ${name(lang, 'en')} (${lang}).`, input, {
					key: cfg.key || undefined,
					via: cfg.via,
					system: SYSTEM,
					maxTokens: cfg.maxTokens,
					signal,
				});
				if (signal.aborted) return;
				for (const line of text.split('\n')) {
					const m = line.match(/^\s*«(\d+)»\s?(.*)$/);
					if (m && ids[m[1] - 1] != null && m[2].trim()) result[ids[m[1] - 1]] = m[2].trim();
				}
				apply();
			}
			status.textContent = 'Translated by AI.';
			original.hidden = false;
			if (cfg.cache) store(cacheKey, result.map((t, i) => t ?? texts[i]));
		} catch (e) {
			if (signal.aborted) return;
			status.textContent = errorText(e);
			status.classList.add('error');
			original.hidden = false;
		}
	}

	const saved = cfg.remember ? store(PREF) : null;
	if (saved && !same(saved, pageLang)) translate(saved);
}

function globe() {
	const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	s.setAttribute('width', '15');
	s.setAttribute('height', '15');
	s.setAttribute('viewBox', '0 0 24 24');
	s.setAttribute('aria-hidden', 'true');
	s.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></g>';
	return s;
}

const CSS = `
.onetag-translate { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; margin-top: .75rem; font-size: var(--sl-text-sm); }
.onetag-translate select { font: inherit; font-size: var(--sl-text-sm); padding: .25rem .4rem; border: 1px solid var(--sl-color-gray-5); border-radius: .4rem; background: var(--sl-color-gray-6); color: var(--sl-color-text); }
.onetag-translate select:focus-visible { outline: 2px solid var(--sl-color-accent); outline-offset: 2px; }
`;
