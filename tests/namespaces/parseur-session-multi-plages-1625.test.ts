// Famille : parseur de session multi-plages (1625) (FAMILLES.md #82)
// Id révélateur : 1625 — time('1','0400-0700,0900-1300') était actif 24/7
// (toute chaîne non reconnue = session permanente) → 0 trades.
// Fix : fork b02e778 — plages séparées par virgules, overnight, suffixe
// :days, bornes égales = 24h ; une chaîne sans plage reconnaissable ne
// matche RIEN (hors session).

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

// Synthetic 1-minute bars, Wednesday 2025-01-01 00:00 UTC → Thursday
// 2025-01-02 23:59 UTC. Session filtering is asserted in UTC.
const DAY = 86_400_000;
const candles = Array.from({ length: 2 * 1440 }, (_, i) => {
    const openTime = Date.UTC(2025, 0, 1) + i * 60_000;
    return {
        openTime,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        closeTime: openTime + 60_000 - 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
});

async function runSession(session: string) {
    const source = `//@version=5
indicator("session parsing")
t = time("1", "${session}", "UTC")
plot(t, "s")
`;
    const engine = new PineTS(candles);
    const { plots } = await engine.run(source);
    const out = new Map<number, number | null>();
    for (const d of plots['s'].data) out.set(d.time, d.value as number | null);
    return out;
}

// bar value at hh:mm UTC on 2025-01-01 (a number means in session, NaN means out)
const at = (bars: Map<number, number | null>, h: number, m = 0): unknown => {
    const v = bars.get(Date.UTC(2025, 0, 1, h, m, 0));
    return typeof v === 'number' && !Number.isNaN(v) ? v : null;
};

describe('parseur de session multi-plages (1625)', () => {
    it('time("1","0400-0700,0900-1300") is active only inside the two ranges', async () => {
        const bars = await runSession('0400-0700,0900-1300');
        // Pre-fix, the comma-separated string matched no single range → the
        // session was permanent: every bar (07:00 and 13:00 included) got a
        // timestamp.
        expect(at(bars, 4, 0)).not.toBeNull();
        expect(at(bars, 6, 59)).not.toBeNull();
        expect(at(bars, 7, 0)).toBeNull();
        expect(at(bars, 9, 0)).not.toBeNull();
        expect(at(bars, 12, 59)).not.toBeNull();
        expect(at(bars, 13, 0)).toBeNull();
        expect(at(bars, 3, 59)).toBeNull();
        expect(at(bars, 8, 0)).toBeNull();
    });

    it('a session string with no recognizable range matches nothing (was: permanent)', async () => {
        const bars = await runSession('not-a-session');
        // Pre-fix, _isInSession returned true for any unrecognized string →
        // every bar was "in session".
        expect(at(bars, 10, 0)).toBeNull();
        expect(at(bars, 3, 0)).toBeNull();
    });
});