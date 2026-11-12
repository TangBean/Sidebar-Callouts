import { build } from 'esbuild';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'sidebar-callouts-tests-'));
try {
	const tests = (await readdir('tests')).filter((file) => file.endsWith('.test.mjs')).sort();
	if (tests.length === 0) throw new Error('No tests found');
	const outputs = [];
	for (const test of tests) {
		const outfile = join(directory, basename(test, '.mjs') + '.cjs');
		await build({
			entryPoints: [join('tests', test)],
			outfile,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			target: 'node20',
			alias: { obsidian: resolve('tests/obsidian-stub.mjs') },
		});
		outputs.push(outfile);
	}
	const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	await rm(directory, { recursive: true, force: true });
}
