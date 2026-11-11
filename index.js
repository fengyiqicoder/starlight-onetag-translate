/**
 * starlight-onetag-translate: a "Read in <your language>" button on every Starlight page.
 * One click translates the page for the reader with AI; nothing to maintain on your side.
 *
 *   import starlightOnetagTranslate from "starlight-onetag-translate";
 *   starlight({ plugins: [starlightOnetagTranslate()] })
 */
import { makePlugin } from './plugin.js';

export default function starlightOnetagTranslate(options = {}) {
	return makePlugin(
		'starlight-onetag-translate',
		{
			key: options.key ?? '',
			site: options.site ?? 'https://onetagai.com',
			languages: options.languages ?? ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'pt-BR', 'fr', 'de', 'ru', 'it', 'tr', 'vi', 'id', 'ar', 'hi'],
			remember: options.remember ?? true,
			cache: options.cache ?? true,
			batchChars: options.batchChars ?? 3500,
			maxTokens: options.maxTokens ?? 4000,
		},
		'page translation'
	);
}
