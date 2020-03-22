# Query Dataset

Query your existing datasets, map and generate a subset of your data

Uses MongoDB-like query style, for extended documentation, check [MongoDB query documentation](http://docs.mongodb.org/manual/reference/operator/query/)

It uses [sift](https://www.npmjs.com/package/sift) module for matching, means you can use as query input.

## Example

Take this dataset, for example:

```json
[
    {
        "name": "Name 1",
        "anotherValue": 1
    },
    {
        "name": "Name 2",
        "anotherValue": 2
    },
    {
        "name": "",
        "anotherValue": 3
    }
]
```

You want to query only items that have a name that isn't empty, so you use the following `INPUT`:

```json
{
    "datasetId": "YOUR_DATASET_ID",
    "query": {
        "name": { "$ne": "" }
    }
}
```

`$ne` means "not equal" in MongoDB, so you'll receive "Name 1" and "Name 2" items.

Now say you want to rename the "name" field to something else:

```json
{
    "datasetId": "YOUR_DATASET_ID",
    "query": {
        "name": { "$ne": "" }
    },
    "filterMap": "item.name = item.name.replace('Name ', ''); item.extra = true; return item;"
}
```

Your generated dataset is now:

```json
[
    {
        "name": "1",
        "anotherValue": 1,
        "extra": true,
    },
    {
        "name": "2",
        "anotherValue": 2,
        "extra": true,
    }
]
```

## filterMap and customOperationSetup

The `filterMap` parameter exists to do even more complex checks. `filterMap` is run in a limited context, and those are the variables available inside your function:

`sift`: the [sift](https://www.npmjs.com/package/sift) module, so you can create a filter on-the-fly
`console.log`: tied to the 'outside' `console.log` and outputs information to the actor log
`item`: the current dataset item
`index`: the current filtered index
`total`: total items available in the dataset
`filter`: the created filter from `query` parameter
`datasetIndex`: the current position in the dataset index

The `customOperationSetup` is mostly useful to prepare a [custom operation](https://www.npmjs.com/package/sift#custom-operations) using `sift`:

```js
{
    $gtDate(params, ownerQuery, options) {
        const timestamp = new Date(params).getTime();

        return createEqualsOperation(
            value => new Date(value).getTime() > timestamp, // 'value' here is the date from the field you provide
            ownerQuery,
            options
        );
    }
}
```

then use directly inside your `query` ("2020-01-01" is passed as param to `params`):

```json
{
    "query": {
        "lastModified": { "$gtDate": "2020-01-01" }
    }
}
```

Most of the time, you won't need to use `customOperationSetup`, since the built-in operators can do a lot by themselves, but they are provided for completeness.

## Expected Usage

The memory requirements should be low, but you need at least 256MB, the dataset items aren't loaded all at once in memory, but depending on the shape of your query, you may need more. The more query parameters you provide, more memory and CPU are required, subsequently your query finishes faster.

## Limitations

Some types aren't allowed in JSON, such as `Date` and `RegExp`. The workaround is to define a query without those types, then inside the `filterMap`, you return either null or undefined for dates or RegExp that don't match.

E.g.:

```json
{
    "datasetId": "YOUR_DATASET_ID",
    "query": {

    },
    "filterMap": "if (new Date(item.someDateField).getTime() < new Date(2019, 10, 20)) { return item }"
}
```

Or you can use the `customOperationSetup`

## License

Apache-2.0
