// SPDX-License-Identifier: AGPL-3.0-only

import { parseInputOptions, resolveInput } from '../utils';

export function timeframe(context: any) {
    return (...args: any[]) => {
        const options = parseInputOptions(args);
        // Comme toutes les autres méthodes input.* : résolution override
        // (par varId, puis par title) avant le defval. Sans resolveInput,
        // un override runtime d'input.timeframe est silencieusement perdu
        // (le defval gagne toujours) — découvert via le lowering v4
        // input.resolution → input.timeframe (revue L1 VIN-42 ité 2).
        return resolveInput(context, options);
    };
}
