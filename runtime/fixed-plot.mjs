// VIN-155: static plot options; initialization and key resolution stay in PineTS.
export function makePlot(context, initialize) {
    let plot, title, pointOptions;
    return (source) => {
        // A named-arguments object, null, undefined or any non-scalar must still
        // pass through PineTS argument parsing; it is not a positional series value.
        const positional = ['number', 'boolean', 'string'].includes(typeof source);
        if (!plot || !positional || context.isSecondaryContext) {
            const result = initialize(source);
            if (!plot && positional && result) {
                plot = result;
                const point = plot.data.at(-1);
                title = point.title;
                pointOptions = { ...point.options };
            }
            return result;
        }
        plot.data.push({ title, time: context.marketData[context.idx].openTime, value: source, options: { ...pointOptions } });
        return plot;
    };
}
