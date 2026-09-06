// VIN-156: verify the actual npm archive in an isolated consumer before release.
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = mkdtempSync(join(tmpdir(), 'pinets-package-'));
const require = createRequire(import.meta.url);
const npm = 'npm';
const run = (command, args, cwd = consumer) => execFileSync(command, args, { cwd, stdio: 'inherit' });

try {
    const packed = JSON.parse(
        execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], { cwd: root, encoding: 'utf8' }),
    );
    run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', join(consumer, packed[0].filename)]);
    cpSync(join(root, 'tests/packaging'), join(consumer, 'tests/packaging'), { recursive: true });
    cpSync(join(root, 'tests/fixtures/studio-inputs'), join(consumer, 'tests/fixtures/studio-inputs'), { recursive: true });
    run(process.execPath, ['tests/packaging/backtest-vin156.mjs']);
    run(process.execPath, ['tests/packaging/specialization-vin155.mjs']);
    for (const [module, resolution] of [
        ['ESNext', 'Bundler'],
        ['NodeNext', 'NodeNext'],
    ]) {
        run(process.execPath, [
            require.resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            '--target',
            'ES2022',
            '--module',
            module,
            '--moduleResolution',
            resolution,
            'tests/packaging/backtest-types-vin156.mts',
        ]);
    }
    console.log('Installed package: runtime, specialization boundaries, and both type-resolution modes passed.');
} finally {
    rmSync(consumer, { recursive: true, force: true });
}
