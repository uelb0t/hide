import { Faker, faker, fakerES, fakerPT_BR as fakerPT } from "@faker-js/faker";
import { Command, Flags } from "@oclif/core";
import { UniqueEnforcer } from "enforce-unique";
import { Collection, MongoClient } from "mongodb";

type Field = {
  name: string;
  type: string;
};

export default class MongoHide extends Command {
  static description = "Anonymize data in MongoDB.";
  static usage = "--fields=<value> --uri=<value> --db=<value> [options]";

  static examples = [
    "<%= config.bin %> --fields='birthDate, email, name' --db=test --uri=mongodb://localhost:27017",
    "<%= config.bin %> --fields='name, email' --db=test --uri=mongodb://localhost:27017 --includeCollections='users'",
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
      description: "create fake data in this locale",
      default: "en",
      options: ["en", "es", "pt"],
    }),
  };

  private faker: Faker = faker;

  public async run(): Promise<void> {
    const { flags } = await this.parse(MongoHide);

    const client = new MongoClient(flags.uri);
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

    this.faker = this.getFaker(flags.locale);

    const fieldsToAnonymize: Field[] = flags.fields.split(",").map((field) => {
      field = field.trim().toLowerCase();
      const [name, type] = field.split(":");
      return {
        name,
        type: type ?? "infer",
      };
    });

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

    await Promise.all(collectionPromises);
    this.log("✅ Data hidden completed.");

    const timeElapsedInMs = Date.now() - start;
    this.log(
      `⏱️ Time elapsed: ${
        timeElapsedInMs > 1000
          ? Math.floor(timeElapsedInMs / 1000)
          : timeElapsedInMs
      }${timeElapsedInMs > 1000 ? "s" : "ms"}`
    );

    await client.close();
    this.exit();
  }

  private getFaker(locale: string): Faker {
    switch (locale) {
      case "es":
        return fakerES;
      case "pt":
        return fakerPT;
      default:
        return this.faker;
    }
  }

  private async anonymizeCollection(
    collection: Collection,
    fields: Field[]
  ): Promise<number> {
    const cursor = collection.find();

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

  private anonymizeFields(doc: any, fields: Field[]) {
    for (const key in doc) {
      if (!doc) continue;

      const field = fields.find((field) => field.name === key);
      if (field) {
        doc[key] = doc[key] ? this.fakeValue(field) : doc[key];
      } else if (Array.isArray(doc[key])) {
        for (const element of doc[key]) {
          this.anonymizeFields(element, fields);
        }
      } else if (typeof doc[key] === "object" && doc[key] !== null) {
        this.anonymizeFields(doc[key], fields);
      }
    }
  }

  private fakeValue(field: Field): any {
    if (field.type === "infer") {
      const uniqueEnforcerEmail = new UniqueEnforcer();

      if (field.name.includes("name")) {
        if (field.name.includes("company") || field.name.includes("group"))
          return this.faker.company.name();
        return this.faker.person.fullName();
      }

      if (field.name.includes("company")) return this.faker.company.name();
      if (field.name.includes("email"))
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
      if (field.name.includes("phone"))
        return this.faker.phone.number().replace(/\D/g, "");
      if (field.name.includes("address"))
        return this.faker.location.streetAddress();
      if (field.name.includes("street")) return this.faker.location.street();
      if (field.name.includes("country")) return this.faker.location.country();
      if (field.name.includes("city")) return this.faker.location.city();
      if (field.name.includes("state")) return this.faker.location.state();
      if (field.name.includes("zip")) return this.faker.location.zipCode();
      if (field.name.includes("description"))
        return this.faker.lorem.paragraph();
      if (field.name.includes("date"))
        return this.faker.date.past({
          years: 10,
          refDate: new Date("2000-01-01"),
        });
      if (field.name.includes("url")) return this.faker.internet.url();
      if (field.name.includes("ip")) return this.faker.internet.ip();
      if (field.name.includes("salary") || field.name.includes("amount"))
        return this.faker.finance.amount({ min: 1000, max: 100_000 });

      return this.faker.lorem.word();
    }

    return this.getFakerMethod(field);
  }

  private getFakerMethod(field: Field) {
    const [moduleName = "", methodName = ""] = field.type.split(".");
    const fakerModule: any = faker[moduleName as keyof Faker];
    if (!fakerModule || typeof fakerModule !== "object") {
      this.error(
        `${field.type} has invalid module. Please check faker-js docs.`
      );
    }

    const fakerMethod = fakerModule[methodName as keyof typeof fakerModule];
    if (typeof fakerMethod !== "function") {
      this.error(
        `${field.type} has invalid method. Please check faker-js docs.`
      );
    }

    let options = {};
    if (field.type === "string.numeric") {
      options = { length: 10 };
    }

    return fakerMethod(options);
  }
}
