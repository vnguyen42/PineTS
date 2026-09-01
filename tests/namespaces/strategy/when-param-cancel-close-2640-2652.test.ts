// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille `when-param-cancel-close` — ids 2640 (BINANCE:UNIUSDT 60) et 2652
// (BINANCE:NEARUSDT 240).
//
// Deux defauts de la meme famille : le parametre `when` des fonctions
// strategy.* n'etait pas honore par `cancel` et n'etait pas atteignable
// positionnellement par `close`.
//
//   2640 — `strategy.cancel('Safety order' + i_s, when=status_none)` : `when`
//     n'existait pas dans la table de types de cancel.ts, donc la garde
//     n'existait pas ; chaque ordre limite de securite etait detruit sur la
//     barre meme ou il etait pose.
//
//   2652 — `strategy.close('up', trendDown > e1)` : la signature unique de
//     close.ts placait `comment` (type string) au 2e positionnel et `when` en
//     dernier ; le booleen invalidait la signature, `when` n'etait jamais
//     peuple et le close s'executait a CHAQUE barre.
//
// close_all n'est PAS concerne : il normalise deja la forme v4
// `close_all(when, ...)` avant le parsing (close_all.ts, bloc
// `hasPositionalWhen`). Les sous-tests close_all ci-dessous le prouvent et
// verrouillent ce comportement.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import type { Context } from '../../../src/Context.class';

// b3 plonge a 90 : un limit buy a 95 pose avant s'y remplit.
const BARS = [
    { openTime: 0, closeTime: 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 60_000, closeTime: 120_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 120_000, closeTime: 180_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 180_000, closeTime: 240_000, open: 100, high: 101, low: 90, close: 100, volume: 1 },
    { openTime: 240_000, closeTime: 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 300_000, closeTime: 360_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 360_000, closeTime: 420_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
];

async function run(source: string): Promise<Context> {
    const pineTS = new PineTS(BARS, 'TEST', '1');
    return pineTS.run(source);
}

// Ordre limite de securite (motif 2640) pose en b0, annulable en b1, rempli
// en b3 s'il a survecu, solde en b5.
const cancelSource = (cancelCall: string) => `
//@version=5
strategy('cancel when', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('SO', strategy.long, qty=1, limit=95)
if bar_index == 1
    ${cancelCall}
if bar_index == 5
    strategy.close_all('final')
`;

// Entree marche en b0 (remplie a l'open de b1), close conditionnel en b2,
// solde en b5 (motif 2652).
const closeSource = (closeCall: string) => `
//@version=5
strategy('close when', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 2
    ${closeCall}
if bar_index == 5
    strategy.close_all('final')
`;
// Forme legacy v4 : entree de 2 contrats en b0, close en b2.
const v4CloseSource = (closeCall: string) => `
//@version=4
strategy('close v4 positional', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 2
    ${closeCall}
`;

describe('2640 — strategy.cancel(id, when=...)', () => {
    it('(1) when=false : aucune annulation, l ordre limite survit et se remplit', async () => {
        const context = await run(cancelSource(`strategy.cancel('SO', when=false)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({
            entry_id: 'SO',
            entry_price: 95,
            exit_comment: 'final',
        });
    });

    it('(1bis) when=na : aucune annulation (falsy explicite, meme garde)', async () => {
        const context = await run(cancelSource(`strategy.cancel('SO', when=na)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'SO', entry_price: 95 });
    });

    it('(2) when=true : annulation, l ordre limite ne se remplit jamais', async () => {
        const context = await run(cancelSource(`strategy.cancel('SO', when=true)`));

        expect(context.strategy?.closedtrades).toHaveLength(0);
        expect(context.strategy?.pending_orders).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('(2bis) when=<serie booleenne vraie> : annulation', async () => {
        const context = await run(cancelSource(`strategy.cancel('SO', when=close > 50)`));

        expect(context.strategy?.closedtrades).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('(3) sans when : annulation inconditionnelle, comportement historique', async () => {
        const context = await run(cancelSource(`strategy.cancel('SO')`));

        expect(context.strategy?.closedtrades).toHaveLength(0);
        expect(context.strategy?.pending_orders).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('(3bis) sans when, id non concerne : les pending d un autre id restent', async () => {
        const context = await run(cancelSource(`strategy.cancel('AUTRE')`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'SO', entry_price: 95 });
    });
});

describe('2652 — strategy.close(id, <booleen positionnel>)', () => {
    it('(4a) booleen positionnel faux : aucun close, la position vit jusqu au solde', async () => {
        const context = await run(closeSource(`strategy.close('L', false)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            exit_comment: 'final',
            exit_bar_index: 6,
        });
    });

    it('(4b) expression booleenne positionnelle fausse (forme 2652) : aucun close', async () => {
        const context = await run(closeSource(`strategy.close('L', low > high)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ exit_comment: 'final', exit_bar_index: 6 });
    });

    it('(4c) booleen positionnel vrai : close execute a la barre suivante', async () => {
        const context = await run(closeSource(`strategy.close('L', true)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', exit_bar_index: 3 });
        expect(context.strategy?.closedtrades[0].exit_comment).toBeFalsy();
    });

    it('(4d) expression booleenne positionnelle vraie (forme 2652) : close execute', async () => {
        const context = await run(closeSource(`strategy.close('L', high > low)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ exit_bar_index: 3 });
    });

    it('(5) commentaire positionnel : inchange, close execute et commentaire conserve', async () => {
        const context = await run(closeSource(`strategy.close('L', 'XL')`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            exit_comment: 'XL',
            exit_bar_index: 3,
        });
    });

    it('(5bis) when nomme faux + commentaire positionnel : no-op, commentaire ignore', async () => {
        const context = await run(closeSource(`strategy.close('L', 'XL', when=false)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ exit_comment: 'final', exit_bar_index: 6 });
    });

    it('(5ter) forme v4 : when vrai puis qty ferme un contrat sur deux', async () => {
        const context = await run(v4CloseSource(`strategy.close('L', true, 1)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', size: 1, exit_bar_index: 3 });
        expect(context.strategy?.position_size).toBe(1);
        expect(context.strategy?.opentrades).toHaveLength(1);
        expect(context.strategy?.opentrades[0]).toMatchObject({ entry_id: 'L', size: 1 });
    });

    it('(5quater) forme v4 : commentaire au cinquieme slot conserve', async () => {
        const context = await run(v4CloseSource(`strategy.close('L', true, na, na, 'XL')`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            size: 2,
            exit_comment: 'XL',
            exit_bar_index: 3,
        });
        expect(context.strategy?.position_size).toBe(0);
    });
});

describe('(6) strategy.close_all — forme v4 positionnelle deja supportee', () => {
    const closeAllSource = (call: string) => `
//@version=5
strategy('close_all when', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 2
    ${call}
if bar_index == 5
    strategy.close_all('final')
`;

    it('booleen positionnel faux : no-op', async () => {
        const context = await run(closeAllSource(`strategy.close_all(false)`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ exit_comment: 'final', exit_bar_index: 6 });
    });

    it('booleen positionnel vrai + comment nomme : close execute', async () => {
        const context = await run(closeAllSource(`strategy.close_all(true, comment='CA')`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ exit_comment: 'CA', exit_bar_index: 3 });
    });

    it('commentaire positionnel : inchange, close execute', async () => {
        const context = await run(closeAllSource(`strategy.close_all('CA')`));

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ exit_comment: 'CA', exit_bar_index: 3 });
    });
});
