// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « timeframes multi-unités ('3D') » — ticket VIN-124, id révélateur
// 2123, fixée par le commit fork 8e7a05f (JOURNAL.md:527-531, 560-565 ;
// ancre VIN-124 : JOURNAL.md:602). timeframeToMinutes/alignToTimeframe
// refusaient les formes calendaires multi-unités : 2123 ('3D' via
// input.session) était RUNTIME_CRASH. Fix : 'ND' → N×1440 minutes, buckets
// N-jours ancrés à l'époque UTC.
//
// RED-PROOF : ce test échoue sur le worktree parent `8e7a05f^` — time("3D")
// changeait à CHAQUE barre (aucun alignement N-période).
//
// Contrat observable : sur un feed journalier, time("3D") rend l'ouverture
// du bucket de 3 jours (ancré à l'époque UTC), pas l'openTime de chaque
// barre. La couverture complète du diff multi-unité (bornes, insensibilité
// à la casse, 2W/2M, provider) vit dans timeframe-multi-unit.test.ts, ajouté
// avec le même commit ; ce fichier porte l'identifiant VIN-124 exigé pour
// rattacher la famille.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

const DAY_MS = 86_400_000;

interface Candle {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

describe('timeframes multi-unités — time("3D") (VIN-124, commit 8e7a05f)', () => {
    it('aligne l\'heure de barre sur des buckets de 3 jours', async () => {
        // 2024-01-03 est dayIndex 19725 ≡ 0 (mod 3) : le premier bucket
        // 3-jours s'ouvre sur la barre 0 (ancre époque UTC, même convention
        // que le test de revue du diff).
        const startDay = 19725;
        const candles: Candle[] = Array.from({ length: 6 }, (_, i) => {
            const openTime = (startDay + i) * DAY_MS;
            return { openTime, closeTime: openTime + DAY_MS - 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };
        });
        const engine = new PineTS(candles, 'TEST', 'D');
        const context = await engine.run(
            '//@version=5\nindicator("vin124")\nt3 = time("3D")\nplot(t3, "t3")',
        );
        const values = (context.plots['t3']?.data ?? []).map((p: { value: number | null }) => p.value);

        const expected = candles.map((c) => Math.floor(c.openTime / DAY_MS / 3) * 3 * DAY_MS);
        // Trois jours 2024-01-03/04/05 → bucket 1, trois jours 06/07/08 →
        // bucket 2 : la série change exactement à la barre 3.
        const changeBars: number[] = [];
        for (let i = 1; i < values.length; i++) {
            if (values[i] !== values[i - 1]) changeBars.push(i);
        }
        expect(values).toEqual(expected);
        expect(changeBars).toEqual([3]);
    });
});