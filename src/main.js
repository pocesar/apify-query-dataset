/* eslint-disable no-console */
const Apify = require('apify');
const { default: sift, createEqualsOperation, createQueryTester } = require('sift'); // eslint-disable-line no-unused-vars
const vm = require('vm');

const { log } = Apify.utils;

/**
 * There's no other way to provide access to the local scope unless we use eval
 *
 * @param {string} customOperationSetup
 */
const evalSetup = (customOperationSetup) => {
    if (!customOperationSetup) {
        return {};
    }
    return eval(`(() => { return (${customOperationSetup}); })()`); // eslint-disable-line no-eval
};

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        datasetId,
        query,
        filterMap = 'return item',
        customOperationSetup = null,
    } = input;

    if (!datasetId) {
        throw new Error('You must provide a "datasetId" as string');
    }

    const datasetInfo = await Apify.client.datasets.getDataset({ datasetId });

    if (!datasetInfo) {
        throw new Error(`Invalid datasetId provided or you don't have access: ${datasetId}`);
    }

    const total = datasetInfo.itemCount;

    if (!total) {
        log.info('Dataset is empty, exiting...');

        return;
    }

    if (!query || typeof query !== 'object') {
        throw new Error('You must provide "query" as an object');
    }

    if (!filterMap || typeof filterMap !== 'string') {
        throw new Error('Parameter "filterMap" must be a string');
    }

    if (customOperationSetup && typeof customOperationSetup !== 'string') {
        throw new Error('Parameter "customOperationSetup" must be a string');
    }

    let {
        limit = Infinity,
        offset = 0,
    } = input;

    limit = +limit;
    offset = +offset;

    if (!limit || limit < 0) {
        throw new Error('The parameter "limit" must be greater than 0');
    }

    if (Number.isNaN(offset) || offset < 0) {
        throw new Error('The parameter "offset" must be greater or equal to 0');
    }

    const c = 'Process took';
    console.time(c);

    const dataset = await Apify.openDataset(datasetId, { forceCloud: true });
    /** @type {any} */
    const available = {
        sift,
        total,
        console: {
            log: console.log.bind(console),
        },
    };

    const parsingContext = (extra = {}) => vm.createContext(Object.assign(Object.create(null), available, extra));
    /** @type {any} */
    let operations = {};

    if (customOperationSetup) {
        let result;

        try {
            result = evalSetup(customOperationSetup);
        } catch (e) {
            log.exception(e.message, 'customOperationSetup failed');
            return;
        }

        if (!result || (typeof result !== 'object' && Array.isArray(result))) {
            throw new Error('Parameter "customOperationSetup" must return an object');
        }

        operations = {
            ...result,
        };
    }

    /** @type {Function} */
    let filter;

    try {
        filter = sift(query, { operations });
    } catch (e) {
        log.exception(e.message, 'sift failed to compile query');
        return;
    }

    available.filter = filter;
    const filterMapFn = vm.compileFunction(filterMap, ['item', 'index', 'datasetIndex'], {
        parsingContext: parsingContext(),
        filename: 'filterMap',

    });

    let count = 0;
    let index = -1; // increment when we find something, starts at 0

    log.info(`Starting querying ${datasetInfo.itemCount} dataset items...`);

    try {
        await dataset.forEach(async (item, datasetIndex) => {
            if (filter(item)) {
                index++;
                // count as "filtered", but skip
                if (index < offset) {
                    return;
                }

                let filtered;

                try {
                    // a filterMap means that null or undefined get's filtered out
                    // the result must be either an array or object
                    filtered = await filterMapFn(item, index, datasetIndex);
                } catch (e) {
                    log.exception(e.message, 'filterMap failed', { index, datasetIndex });
                    return;
                }

                if (filtered !== null && filtered !== undefined) {
                    if (typeof filtered === 'object') {
                        count++;
                        await Apify.pushData(filtered);

                        if (count >= limit) {
                            throw new Error('break');
                        }
                    } else {
                        log.warning('Return value of filterMap is not an object or array', { index, datasetIndex, filtered });
                    }
                }
            }
        });
    } catch (e) {
        // we expect a break in case of "limit", the only way to
        // stop dataset.forEach
        if (e.message !== 'break') {
            log.exception(e);
        }
    }

    console.timeEnd(c);
    log.info(`Generated ${count} items using ${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)}MB`);
});
