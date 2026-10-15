// Famille : CLOSE_BATCH_EXIT_ORDER — ordre d'exécution des brackets d'activations
// remplies ENSEMBLE au close d'une barre (id révélateur 2640, BINANCE:UNIUSDT tf 60,
// grille DCA sous process_orders_on_close, un strategy.exit par ordre de sécurité).
//
// Règle TV mesurée sur le ledger canonique de 2640
// (oracle-archives/tv-vin95-b/2640/01-report-raw.json) : quand plusieurs limites déjà
// marketables au close de B y sont remplies ensemble, leurs brackets déclenchés au même
// point s'exécutent de l'activation la PLUS RÉCENTE à la plus ancienne, et chacun prélève
// les lots physiques en FIFO. Deal sortie 2024-01-10T04:00Z : SO1/SO2/SO3 remplis au close
// 5.98 ; le bracket de SO3 (10.836) ferme SO1 3.344 + SO2 6.02 + 1.472 de SO3, puis ceux de
// SO2 et SO1 ferment 6.02 et 3.344 de SO3. 57/57 lots de close de ce type suivent cette
// règle ; les activations remplies à des points distincts gardent l'ordre d'appel.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

function candle(openTime: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: openTime + 86_399_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const DAY = 86_400_000;

describe('2640 — brackets of a close batch execute newest activation first', () => {
    it('lets the later close-filled activation bracket consume the older lot first', async () => {
        const candles = [
            candle(0, 99, 101, 98, 100),
            candle(DAY, 100, 100.5, 96, 97),
            candle(2 * DAY, 97, 104, 96.5, 103.5),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2640 close batch exits', process_orders_on_close=true, pyramiding=5)
if bar_index == 0
    strategy.entry('BO', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('SO1', strategy.long, qty=2, limit=99.0)
    strategy.entry('SO2', strategy.long, qty=3, limit=98.0)
strategy.exit('TP', 'BO', limit=103.0)
strategy.exit('TP', 'SO1', limit=103.0)
strategy.exit('TP', 'SO2', limit=103.0)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // SO1 and SO2 both fill at the bar-1 close 97 (close-marketable limits).
        expect(strategy.closedtrades.map((t) => [t.entry_id, t.entry_price, Math.abs(t.size)])).toEqual([
            ['BO', 100, 1],
            ['SO1', 97, 2],
            ['SO2', 97, 1],
            ['SO2', 97, 2],
        ]);
        expect(strategy.opentrades).toHaveLength(0);
    });

    // Review P1: one exit order over several close-filled lots is not a batch of
    // single-activation brackets — its per-lot events keep FIFO, no lot split.
    it('leaves a single wildcard exit over a close batch unsplit', async () => {
        const candles = [
            candle(0, 99, 101, 98, 100),
            candle(DAY, 100, 100.5, 96, 97),
            candle(2 * DAY, 97, 104, 96.5, 103.5),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2640 close batch wildcard exit', process_orders_on_close=true, pyramiding=5)
if bar_index == 1
    strategy.entry('SO1', strategy.long, qty=2, limit=99.0)
    strategy.entry('SO2', strategy.long, qty=3, limit=98.0)
strategy.exit('TP', limit=103.0)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades.map((t) => [t.entry_id, Math.abs(t.size)])).toEqual([
            ['SO1', 2],
            ['SO2', 3],
        ]);
    });

    // Review P2: a bracket of an OLDER close fill called between the batch's
    // brackets keeps its slot; only the batch is reversed inside its own slots
    // (deterministic, independent of the sort implementation).
    it('reverses a close batch inside its own slots around an older close-filled bracket', async () => {
        const candles = [
            candle(0, 99, 101, 98, 100),
            candle(DAY, 100, 100.5, 96, 97),
            candle(2 * DAY, 97, 104, 96.5, 103.5),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2640 close batch interleaved', process_orders_on_close=true, pyramiding=5)
if bar_index == 0
    strategy.entry('X', strategy.long, qty=1, limit=101.0)
if bar_index == 1
    strategy.entry('SO1', strategy.long, qty=2, limit=99.0)
    strategy.entry('SO2', strategy.long, qty=3, limit=98.0)
strategy.exit('TP', 'SO1', limit=103.0)
strategy.exit('TP', 'X', limit=103.0)
strategy.exit('TP', 'SO2', limit=103.0)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // Execution SO2 (3: X 1 + SO1 2), X (1 of SO2), SO1 (2 of SO2).
        expect(strategy.closedtrades.map((t) => [t.entry_id, Math.abs(t.size)])).toEqual([
            ['X', 1],
            ['SO1', 2],
            ['SO2', 1],
            ['SO2', 2],
        ]);
    });
});
