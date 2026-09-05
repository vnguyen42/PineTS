// VIN-152: preserve the pre-optimization polyline output channel, including force_overlay.
import { PineTS } from 'index';
import { expect, it } from 'vitest';

it('VIN-152 keeps regular and force-overlay polylines in the existing output channel', async () => {
    const candles = [0, 1].map(i => ({
        openTime: 1704067200000 + i * 60000,
        closeTime: 1704067259999 + i * 60000,
        open: 1, high: 2, low: 1, close: 2, volume: 10,
    }));
    const engine = new PineTS(candles);
    const context = await engine.run(`//@version=6
indicator("Polyline output compatibility", overlay=false)
if barstate.islast
    points = array.from(chart.point.from_index(0, 1), chart.point.from_index(1, 2))
    polyline.new(points)
    polyline.new(points, force_overlay=true)
`);
    const entry = context.plots['__polylines__'];
    expect(context.plots).not.toHaveProperty('__polylines_overlay__');
    expect(entry.options).toEqual({ style: 'drawing_polyline', overlay: false });
    expect(entry.data).toHaveLength(1);
    expect(entry.data[0].value.map(p => p.force_overlay)).toEqual([false, true]);
    expect(entry.data[0].value.map(p => p.points.map(point => point.price))).toEqual([[1, 2], [1, 2]]);
});
