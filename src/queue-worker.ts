import { insertMedia, insertRecord, parseCSV } from "./events";
import postgres from "postgres";
import type { CSVRecord } from "./events";
import { getDeviceId } from "./device";
import { createLogger } from "./utils/logger";

export default {
  async queue(batch: MessageBatch<any>, env: any, ctx: ExecutionContext) {
    const logger = createLogger(ctx);
    logger.info(`Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      const { token, objectKey, fileType, filename } = message.body;
      const messageLogger = createLogger(ctx, {
        messageId: message.id,
        fileType,
        objectKey,
      });

      // Create a new connection for each message
      const sql = postgres(env.HYPERDRIVE.connectionString);

      try {
        messageLogger.info("Processing message", { filename });
        messageLogger.debug(`Getting device ID for token: ${token}`);
        const deviceId = await getDeviceId(token, sql);
        messageLogger.info(`Device identified`, { deviceId });

        const fileResponse = await env.BUCKET.get(objectKey);
        if (!fileResponse) {
          messageLogger.error("File not found in R2");
          continue;
        }

        if (fileType.toLowerCase().includes("csv")) {
          messageLogger.info("Processing CSV file");
          const csvText = await fileResponse.text();
          const records = parseCSV(csvText, ctx);

          await sql.begin(async (txSql) => {
            const insertPromises = records.map((record: CSVRecord) =>
              insertRecord(record, deviceId, txSql, ctx)
            );
            await Promise.all(insertPromises);
          });

          messageLogger.info("Successfully inserted records");
        } else if (fileType.toLowerCase().includes("jpg")) {
          messageLogger.info("Processing JPG file", { filename });
          let tsData = filename.split("/");
          let ts = tsData[tsData.length - 1].split(".")[0];
          await insertMedia(objectKey, deviceId, ts ?? "", sql, ctx);
        } else {
          messageLogger.info(`Skipping non-CSV file: ${fileType}`);
        }
      } catch (error) {
        messageLogger.error("Error during message processing:", error);
        throw error; // Re-throw to ensure the message isn't marked as processed
      } finally {
        await sql.end({ timeout: 5 }); // Add timeout for clean shutdown
      }
    }

    logger.info(`Finished processing batch`);
  },
};
