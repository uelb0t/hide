import { Faker, faker, fakerPT_BR as fakerBR, fakerES } from "@faker-js/faker";
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
    uri: Flags.string({
      description: "database uri.",
      required: true,
    }),
    db: Flags.string({
      description: "database name.",
      required: true,
    }),
    fields: Flags.string({
      description: "fields to anonymize (comma separated, case insensitive).",
      required: true,
    }),
    includeCollections: Flags.string({
      description:
        "only includes these collections (comma separated, case sensitive).",
    }),
    excludeCollections: Flags.string({
      description: "excludes collections (comma separated, case sensitive).",
    }),
    locale: Flags.string({
      description: "locale to use for faker.",
      default: "en",
      options: ["en", "es", "ptBR"],
    }),
  };

  private faker: Faker = faker;

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

      this.faker = this.getFaker(flags.locale);

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

  private getFaker(locale: string): Faker {
    switch (locale) {
      case "es":
        return fakerES;
      case "pt_BR":
        return fakerBR;
      default:
        return this.faker;
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
        return this.faker.company.name();
      return this.faker.person.fullName();
    }

    if (field.includes("company")) return this.faker.company.name();
    if (field.includes("email"))
      return uniqueEnforcerEmail.enforce(
        () => {
          return this.faker.internet
            .email({ provider: "mongohide.dev" })
            .toLowerCase();
        },
        {
          maxTime: 1000,
        }
      );
    if (field.includes("phone"))
      return this.faker.phone.number().replace(/\D/g, "");
    if (field.includes("address")) return this.faker.location.streetAddress();
    if (field.includes("street")) return this.faker.location.street();
    if (field.includes("country")) return this.faker.location.country();
    if (field.includes("city")) return this.faker.location.city();
    if (field.includes("state")) return this.faker.location.state();
    if (field.includes("zip")) return this.faker.location.zipCode();
    if (field.includes("description")) return this.faker.lorem.paragraph();
    if (field.includes("date"))
      return this.faker.date.past({
        years: 10,
        refDate: new Date("2000-01-01"),
      });
    if (field.includes("url")) return this.faker.internet.url();
    if (field.includes("ip")) return this.faker.internet.ip();
    return this.faker.word.words({ count: { min: 1, max: 1 } });
  }
}
