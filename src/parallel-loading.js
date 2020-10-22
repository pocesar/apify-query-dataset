const Apify = require('apify');
const Promise = require('bluebird');

// Returns either null if offset/limit does not fit the current chunk
// or { offset, limit } object
const calculateLocalOffsetLimit = ({ offset, limit, localStart, batchSize }) => {
    const localEnd = localStart + batchSize;
    const inputEnd = offset + limit;

    // Offset starts after the current chunk
    if (offset >= localEnd) {
        return null;
    }
    // Offset + limit ends before our chunk
    if (inputEnd <= localStart) {
        return null;
    }

    // Now we know that the some data are in the current batch
    const calculateLimit = () => {
        // limit overflows current batch
        if (inputEnd >= localEnd) {
            // Now either the offset is less than local start and we do whole batch
            if (offset < localStart) {
                return batchSize;
            }
            // Or it is inside the current batch and we slice it from the start (including whole batch)
            return localEnd - offset;
        // eslint-disable-next-line no-else-return
        } else { // Consider (inputEnd < localEnd) Means limit ends inside current batch
            if (offset < localStart) {
                return inputEnd - localStart;
            }
            // This means both offset and limit are inside current batch
            return inputEnd - offset;
        }
    };

    return {
        offset: Math.max(localStart, offset),
        limit: calculateLimit(),
    };
};

module.exports.calculateLocalOffsetLimit = calculateLocalOffsetLimit;

/**
 * Loads items from one or many datasets in parallel by chunking the items from each dataset into batches,
 * retaining order of both items and datasets. Useful for large loads.
 * By default returns one array of items in order of datasets provided.
 * By changing concatItems or concatDatasets options, you can get array of arrays (of arrays) back
 * Requires bluebird dependency and copy calculateLocalOffsetLimit function!!!
 *
 * @param {string[]} datasetIds IDs of datasets you want to load
 * @param {object} options Options with default values.
 * If both concatItems and concatDatasets are false, output of this function is an array of datasets containing arrays of batches containig array of items.
 * concatItems concats all batches of one dataset into one array of items.
 * concatDatasets concat all datasets into one array of batches
 * Using both concatItems and concatDatasets gives you back a sinlge array of all items in order.
 * Both are true by default.
 * @param {Function} options.processFn - Data are not returned by fed to the supplied async function on the fly (reduces memory usage)
 * @param {number} options.parallelLoads
 * @param {number} options.batchSize
 * @param {number} options.offset=0
 * @param {number} options.limit=999999999
 * @param {boolean} options.concatItems
 * @param {boolean} options.concatDatasets
 * @param {boolean} options.fields
 * @param {boolean} options.debugLog
 */

module.exports.loadDatasetItemsInParallel = async (datasetIds, options = {}) => {
    const {
        processFn,
        parallelLoads = 20,
        batchSize = 50000,
        offset = 0,
        limit = 999999999,
        concatItems = true,
        concatDatasets = true,
        fields,
        debugLog,
    } = options;

    const loadStart = Date.now();

    const createRequestArray = async () => {
        // We increment for each dataset so we remember their order
        let datasetIndex = 0;

        // This array will be used to create promises to run in parallel
        const requestInfoArr = [];

        for (const datasetId of datasetIds) {
            // We get the number of items first and then we precreate request info objects
            const { cleanItemCount } = await Apify.client.datasets.getDataset({ datasetId });
            console.log(`Dataset ${datasetId} has ${cleanItemCount} items`);
            const numberOfBatches = Math.ceil(cleanItemCount / batchSize);

            for (let i = 0; i < numberOfBatches; i++) {
                const localOffsetLimit = calculateLocalOffsetLimit({ offset, limit, localStart: i * batchSize, batchSize });
                if (!localOffsetLimit) {
                    continue;
                }
                requestInfoArr.push({
                    index: i,
                    offset: localOffsetLimit.offset,
                    limit: localOffsetLimit.limit,
                    datasetId,
                    datasetIndex,
                });
            }

            datasetIndex++;
        }
        return requestInfoArr;
    };

    // This is array of arrays. Top level array is for each dataset and inside one entry for each batch (in order)
    /** @type {any[]} */
    let loadedBatchedArr = [];

    let totalLoaded = 0;
    const totalLoadedPerDataset = {};

    const requestInfoArr = await createRequestArray();
    if (debugLog) console.log(`Number of requests to do: ${requestInfoArr.length}`);

    //  Now we execute all the requests in parallel (with defined concurrency)
    await Promise.map(requestInfoArr, async (requestInfoObj) => {
        const { index, datasetId, datasetIndex } = requestInfoObj;
        const { items } = await Apify.client.datasets.getItems({
            datasetId,
            offset: requestInfoObj.offset,
            limit: requestInfoObj.limit,
            fields,
        });

        if (!totalLoadedPerDataset[datasetId]) {
            totalLoadedPerDataset[datasetId] = 0;
        }

        totalLoadedPerDataset[datasetId] += items.length;
        totalLoaded += items.length;

        if (debugLog) {
            console.log(
                `Items loaded from dataset ${datasetId}: ${items.length}, offset: ${requestInfoObj.offset},
        total loaded from dataset ${datasetId}: ${totalLoadedPerDataset[datasetId]},
        total loaded: ${totalLoaded}`,
            );
        }
        // We either collect the data or we process them on the fly
        if (processFn) {
            await processFn(items, { datasetId, datasetOffset: requestInfoObj.offset });
        } else {
            if (!loadedBatchedArr[datasetIndex]) {
                loadedBatchedArr[datasetIndex] = [];
            }
            // Now we correctly assign the items into the main array
            loadedBatchedArr[datasetIndex][index] = items;
        }
    }, { concurrency: parallelLoads });

    if (debugLog) console.log(`Loading took ${Math.round((Date.now() - loadStart) / 1000)} seconds`);

    if (!processFn) {
        if (concatItems) {
            for (let i = 0; i < loadedBatchedArr.length; i++) {
                loadedBatchedArr[i] = loadedBatchedArr[i].flatMap((item) => item);
            }
        }

        if (concatDatasets) {
            loadedBatchedArr = loadedBatchedArr.flatMap((item) => item);
        }
        return loadedBatchedArr;
    }
};
