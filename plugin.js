// Plugin factory shared by the starlight-onetag-* packages: injects the browser script with the
// options, reads the key from the option or PUBLIC_ONETAG_KEY, and warns at build time without one.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

function envHasKey(root) {
	if (process.env.PUBLIC_ONETAG_KEY) return true;
	const dir = root instanceof URL ? fileURLToPath(root) : String(root || '.');
	for (const f of ['.env', '.env.production', '.env.local', '.env.production.local']) {
		const p = join(dir, f);
		if (existsSync(p) && /^\s*PUBLIC_ONETAG_KEY\s*=\s*\S+/m.test(readFileSync(p, 'utf8'))) return true;
	}
	return false;
}

export function makePlugin(name, opts, label) {
	return {
		name,
		hooks: {
			'config:setup'({ addIntegration }) {
				addIntegration({
					name,
					hooks: {
						'astro:config:setup'({ injectScript, command, config, logger }) {
							// Page scripts from every integration share one module: keep the names unique.
							const id = name.replace(/\W/g, '_');
							const cfg = JSON.stringify({ ...opts, via: name, base: (config.base || '/').replace(/\/?$/, '/') });
							injectScript(
								'page',
								`import ${id}_init from ${JSON.stringify(name + '/client')};\n` +
									`const ${id}_cfg = ${cfg};\n${id}_cfg.key = ${id}_cfg.key || import.meta.env.PUBLIC_ONETAG_KEY || "";\n${id}_init(${id}_cfg);`
							);
							if (command === 'build' && !opts.key && !envHasKey(config.root)) {
								logger.warn(
									`No OneTag AI key: ${label} will not work on the deployed site. Get a free key (email only): ` +
										`curl -X POST https://onetagai.com/api/signup -H "Content-Type: application/json" -d '{"email":"you@example.com"}' ` +
										`then pass it as { key } or set PUBLIC_ONETAG_KEY.`
								);
							}
						},
					},
				});
			},
		},
	};
}
