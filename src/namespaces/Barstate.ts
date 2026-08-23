import { Series } from '../Series';

export class Barstate {
    private _live: boolean = false;
    private readonly history: Record<string, Series> = {};

    constructor(private context: any) {}

    public setLive() {
        this._live = true;
    }

    /**
     * Return a context-local series for a historical barstate flag.
     *
     * The transpiler uses this only for `barstate.<flag>[n]`; the ordinary
     * getters below intentionally remain scalar so bare `barstate.isfirst`
     * keeps its existing semantics.
     */
    public __series(name: string): Series {
        let series = this.history[name];
        if (!series) {
            series = new Series([]);
            this.history[name] = series;
        }

        const targetLength = Math.max(0, this.context.idx + 1);
        if (series.data.length > targetLength) {
            series.data.length = targetLength;
        }
        for (let index = series.data.length; index < targetLength; index++) {
            series.data.push(this.valueAt(name, index));
        }
        if (targetLength > 0) {
            series.data[targetLength - 1] = this.valueAt(name, targetLength - 1);
        }
        return series;
    }
    private valueAt(name: string, index: number): boolean {
        switch (name) {
            case 'isnew':
                return !this._live;
            case 'islast':
                return index === this.context.length - 1;
            case 'isfirst':
                return index === 0;
            case 'ishistory':
                return index < this.context.length - 1;
            case 'isrealtime':
                return index === this.context.length - 1;
            case 'isconfirmed': {
                const closeTime = this.context.marketData?.[index]?.closeTime ??
                    this.context.data.closeTime?.data?.[index];
                return typeof closeTime === 'number' && closeTime <= Date.now();
            }
            case 'islastconfirmedhistory': {
                const totalBars = this.context.length;
                if (index === totalBars - 1) {
                    const closeTime = this.context.marketData?.[index]?.closeTime ??
                        this.context.data.closeTime?.data?.[index];
                    return typeof closeTime === 'number' && closeTime <= Date.now();
                }
                if (index === totalBars - 2) {
                    const lastCloseTime = this.context.marketData?.[totalBars - 1]?.closeTime;
                    return typeof lastCloseTime === 'number' && lastCloseTime > Date.now();
                }
                return false;
            }
            default:
                return false;
        }
    }

    public get isnew() {
        return !this._live;
    }

    public get islast() {
        return this.context.idx === this.context.length - 1;
    }

    public get isfirst() {
        return this.context.idx === 0;
    }

    public get ishistory() {
        // Use context.length (total bar count) instead of incrementally-built
        // context.data.close.data.length, which only has bars 0..idx during
        // execution and would always equal idx+1 (making ishistory always false).
        return this.context.idx < this.context.length - 1;
    }

    public get isrealtime() {
        // Use context.length for same reason as ishistory above.
        return this.context.idx === this.context.length - 1;
    }

    public get isconfirmed() {
        // Check if the CURRENT bar (not the last bar) has closed.
        // Historical bars are always confirmed; only the live bar is unconfirmed.
        // closeTime is a Series object — access .data[] for raw array indexing.
        const closeTime = this.context.data.closeTime.data[this.context.idx];
        return closeTime <= Date.now();
    }

    public get islastconfirmedhistory() {
        // True on exactly ONE bar: the last confirmed historical bar.
        // Per Pine Script docs: "Returns true if script is executing on the
        // dataset's last bar when market is closed, or on the bar immediately
        // preceding the real-time bar if market is open."
        //
        // Uses context.length (total bar count, set before iteration) instead
        // of the incrementally-built context.data arrays, which only contain
        // bars 0..idx during execution and would falsely return true on every bar.
        const idx = this.context.idx;
        const totalBars = this.context.length;

        if (idx === totalBars - 1) {
            // Last bar in the dataset — true only if market is closed
            // (i.e., this bar's close time is in the past → it's confirmed)
            const closeTime = this.context.data.closeTime.data[idx];
            return closeTime <= Date.now();
        }

        if (idx === totalBars - 2) {
            // Second-to-last bar — true if the last bar is a live/realtime bar
            // (i.e., the last bar's close time is still in the future).
            // Read from context.marketData (full raw candle array, available
            // before iteration starts) to peek at the last bar's close time.
            const lastCloseTime = this.context.marketData?.[totalBars - 1]?.closeTime;
            if (lastCloseTime !== undefined) {
                return lastCloseTime > Date.now();
            }
            return false;
        }

        return false;
    }
}
