# mongohide

NodeJS CLI to hide data in MongoDB. Can handle nested sub-documents fields and arrays. Internally uses [faker.js](https://fakerjs.dev/) to generate fake data.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/mongohide.svg)](https://npmjs.org/package/mongohide)
[![GitHub license](https://img.shields.io/github/license/oclif/hello-world)](https://github.com/oclif/hello-world/blob/main/LICENSE)

# Usage

```bash
npx mongohide \
--fields="name, phone" \
--uri="mongodb://localhost:27017" \
--db="test"
```

### Specify one or more collections to include or exclude

```bash
npx mongohide \
--fields="name, phone" \
--uri="mongodb://localhost:27017" \
--db="test" \
--includeCollections="orders, customers" \
--excludeCollections="products"
```
:warning: **Collections names are case sensitive. Fields are not**.

### Specify faker locale data

```bash
npx mongohide \
--fields="name, phone" \
--uri="mongodb://localhost:27017" \
--db="test" \
--locale="pt_BR"
```


Contributions are welcome! Please open an issue or submit a pull request.
