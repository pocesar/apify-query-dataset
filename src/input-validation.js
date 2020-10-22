module.exports = ({ query, filterMap, customOperationSetup, limit, offset, datasetIds }) => {
    if (!Array.isArray(datasetIds) || datasetIds.length === 0) {
        throw new Error('Input parameter datasetIds must contain valid dataset ID!');
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

    /*
    if (!limit || limit < 0) {
        throw new Error('The parameter "limit" must be greater than 0');
    }

    if (Number.isNaN(offset) || offset < 0) {
        throw new Error('The parameter "offset" must be greater or equal to 0');
    }
    */

}
