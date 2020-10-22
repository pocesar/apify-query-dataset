/* eslint-disable no-console */
const Apify = require('apify');
const { default: sift, createEqualsOperation, createQueryTester } = require('sift'); // eslint-disable-line no-unused-vars
const vm = require('vm');

const { evalSetup, intervalPushData } = require('./utils');
const validateInput = require('./input-validation');
const { loadDatasetItemsInParallel } = require('./parallel-loading');

const { log } = Apify.utils;

Apify.main(async () => {
    const input = await Apify.getInput();
    const {
        datasetId, // Backwards compatibility
        datasetIds = [],
        query,
        filterMap = '({ item }) => item',
        customOperationSetup = null,
        deduplicationKey,

        // Output params
        bufferLimit = 50000,
        outputLimit = Infinity,
        outputOffset = 0,
        includeDatasetId = false, // For multiple datasets

        // loading performance
        parallelLoads = 1,
        loadBatchSize = 10000,
        loadFields,
        loadLimit,
        loadOffset,
    } = input;

    if (datasetId) {
        datasetIds.push(datasetId);
    }

    const limit = +outputLimit;
    const offset = +outputOffset;

    validateInput({ query, filterMap, customOperationSetup, datasetIds });

    const c = 'Process took';
    console.time(c);

    /** @type {any} */
    const available = {
        sift,
        // total,
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
    const filterMapFn = vm.compileFunction(`return ${filterMap}`, [], {
        parsingContext: parsingContext(),
        filename: 'filterMap',
    })();

    let count = 0;
    let index = -1; // increment when we find something, starts at 0

    const { flush, pushData } = await intervalPushData(await Apify.openDataset(), bufferLimit);

    try {
        let incrementingKey = 0;

        const processItems = async (items, { datasetId, datasetOffset }) => {
            let datasetIndex = datasetOffset - 1;
            for (const item of items) {
                datasetIndex++;
                if (filter(item)) {
                    index++;
                    if (index < offset) {
                        continue;
                    }

                    let filtered;

                    try {
                        // a filterMap means that null or undefined get's filtered out
                        // the result must be either an array or object
                        filtered = await filterMapFn({ item, index, datasetIndex});
                    } catch (e) {
                        log.exception(e.message, 'filterMap failed', { index, datasetIndex });
                        continue;
                    }

                    if (filtered !== null && filtered !== undefined) {
                        if (typeof filtered === 'object') {
                            count++;
                            let key = incrementingKey++;

                            if (deduplicationKey) {
                                if (deduplicationKey in item) {
                                    key = item[deduplicationKey];
                                } else {
                                    log.warning('deduplicationKey not found in item', { index, datasetIndex, deduplicationKey });
                                }
                            }

                            if (includeDatasetId) {
                                if (Array.isArray(filtered)) {
                                    filtered = filtered.map((item) => ({ ...item, datasetId }));
                                } else {
                                    filtered.datasetId = datasetId;
                                }
                            }
                            pushData(`${key}`, filtered);

                            if (count >= limit) {
                                throw new Error('break');
                            }
                        } else {
                            log.warning(`Return value of filterMap is not an "object" or "array", got "${typeof filtered}"`, {
                                index,
                                datasetIndex,
                                filtered,
                            });
                        }
                    }
                }
            }
        }
        const datasetLoadOptions = {
            parallelLoads,
            batchSize: loadBatchSize,
            fields: loadFields,
            processFn: processItems,
            limit: loadLimit,
            offset: loadOffset,
        }
        console.dir(datasetIds)
        await loadDatasetItemsInParallel(datasetIds, datasetLoadOptions)
    } catch (e) {
        // we expect a break in case of "limit", the only way to
        // stop dataset.forEach
        if (e.message !== 'break') {
            log.exception(e);
        }
    } finally {
        await flush();
    }

    console.timeEnd(c);
    log.info(`Generated ${count} items using ${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)}MB`);
});
