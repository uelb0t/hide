import { faker } from "@faker-js/faker";
import { Command, Flags } from "@oclif/core";
import { UniqueEnforcer } from "enforce-unique";
import { Collection, MongoClient } from "mongodb";

export default class MongoHide extends Command {
  static description = "Anonymize data in MongoDB.";
  static usage = "--uri=<value> --db=<value> [options]";

  static examples = [
    "<%= config.bin %> --fields='birthDate, email, name' --db=test --uri=mongodb://localhost:27017",
    "<%= config.bin %> --db=test--uri = mongodb://localhost:27017",
  ];

  static flags = {
    version: Flags.version({ char: "v" }),
    help: Flags.help({ char: "h" }),
    uri: Flags.string({
      char: "u",
      description: "database uri.",
      required: true,
    }),
    db: Flags.string({
      char: "d",
      description: "database name.",
      required: true,
    }),
    fields: Flags.string({
      char: "f",
      description: "fields to anonymize (comma separated, case insensitive).",
      default: "name, phone, email",
    }),
    includeCollections: Flags.string({
      description:
        "only includes these collections (comma separated, case sensitive).",
    }),
    excludeCollections: Flags.string({
      description: "excludes collections (comma separated, case sensitive).",
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(MongoHide);

    const client = new MongoClient(flags.uri);
    try {
      await client.connect();
      const db = client.db(flags.db);
      const start = Date.now();

      let collectionsToAnonymize = [];
      if (flags.includeCollections) {
        collectionsToAnonymize = flags.includeCollections
          .split(",")
          .map((collection) => collection.trim());
      } else {
        const dbCollections = await db.listCollections().toArray();
        collectionsToAnonymize = dbCollections
          .filter((collection) => {
            if (flags.excludeCollections) {
              return !flags.excludeCollections
                .split(",")
                .map((collection) => collection.trim())
                .includes(collection.name);
            }

            return true;
          })
          .map((collection) => collection.name);
      }

      const fieldsToAnonymize = flags.fields
        .split(",")
        .map((field) => field.trim());

      let collectionsProcessed = 0;
      const collectionPromises = collectionsToAnonymize.map(
        async (collectionName: string) => {
          const collection = db.collection(collectionName);
          const processedCount = await this.anonymizeCollection(
            collection,
            fieldsToAnonymize
          );
          collectionsProcessed++;
          this.log(
            `Data hidden completed for collection: ${collectionName} (${processedCount} documents)`
          );
          this.log(
            `▶️ Collections processed: ${collectionsProcessed}/${collectionsToAnonymize.length}`
          );
        }
      );

      await Promise.allSettled(collectionPromises);
      this.log("✅ Data hidden completed.");

      const timeElapsedInMs = Date.now() - start;
      this.log(
        `⏱️ Time elapsed: ${
          timeElapsedInMs > 1000
            ? Math.floor(timeElapsedInMs / 1000)
            : timeElapsedInMs
        }${timeElapsedInMs > 1000 ? "s" : "ms"}`
      );
    } catch (error) {
      console.error(error);
    } finally {
      await client.close();
      this.exit();
    }
  }

  private async anonymizeCollection(
    collection: Collection,
    fields: string[]
  ): Promise<number> {
    const cursor = collection.find().stream();

    let bulkUpdate = [];
    let processedCount = 0;

    for await (const document of cursor) {
      this.anonymizeFields(document, fields);

      bulkUpdate.push({
        updateOne: {
          filter: { _id: document._id },
          update: { $set: document },
        },
      });

      processedCount++;

      if (bulkUpdate.length === 1000) {
        await collection.bulkWrite(bulkUpdate, { ordered: false });
        bulkUpdate = [];
      }
    }

    if (bulkUpdate.length > 0) {
      await collection.bulkWrite(bulkUpdate, { ordered: false });
    }

    return processedCount;
  }

  private anonymizeFields(doc: any, fields: string[]) {
    for (const key in doc) {
      if (!doc) continue;

      if (fields.includes(key)) {
        doc[key] = doc[key] ? this.fakeValue(key) : doc[key];
      } else if (Array.isArray(doc[key])) {
        for (const element of doc[key]) {
          this.anonymizeFields(element, fields);
        }
      } else if (typeof doc[key] === "object" && doc[key] !== null) {
        this.anonymizeFields(doc[key], fields);
      }
    }
  }

  private fakeValue(field: string): any {
    const uniqueEnforcerEmail = new UniqueEnforcer();

    field = field.toLowerCase();
    if (field.includes("name")) {
      if (field.includes("company") || field.includes("group"))
        return faker.company.name();
      return faker.person.fullName();
    }

    if (field.includes("company")) return faker.company.name();
    if (field.includes("email"))
      return uniqueEnforcerEmail.enforce(
        () => {
          return faker.internet
            .email({ provider: "mongohide.dev" })
            .toLowerCase();
        },
        {
          maxTime: 1000,
        }
      );
    if (field.includes("phone")) return faker.phone.number().replace(/\D/g, "");
    if (field.includes("address")) return faker.location.streetAddress();
    if (field.includes("street")) return faker.location.street();
    if (field.includes("country")) return faker.location.country();
    if (field.includes("city")) return faker.location.city();
    if (field.includes("state")) return faker.location.state();
    if (field.includes("zip")) return faker.location.zipCode();
    if (field.includes("description")) return faker.lorem.paragraph();
    if (field.includes("date"))
      return faker.date.past({ years: 10, refDate: new Date("2000-01-01") });
    if (field.includes("url")) return faker.internet.url();
    if (field.includes("ip")) return faker.internet.ip();
    return faker.word.words({ count: { min: 1, max: 1 } });
  }
}
