import { describe, expect, it } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

// TradingView 2026-09-07: risk-scope-compile.pine fails at 4:5 with
// "Cannot use 'strategy.risk.max_position_size' in local scope".
describe('VIN-164 risk max_position_size scope', () => {
    it('rejects the exact TradingView local-scope witness', () => {
        const result = pineToJS(`//@version=5
strategy("Risk scope witness")
if close > 0
    strategy.risk.max_position_size(15)
`);
        expect(result.success).toBe(false);
        expect(result.error).toBe("Cannot use 'strategy.risk.max_position_size' in local scope");
    });
    it('accepts the same call in global scope', () => {
        const result = pineToJS(`//@version=5
strategy("Risk scope positive control")
strategy.risk.max_position_size(15)
`);
        expect(result.success).toBe(true);
    });
});
