import { insertMedia, insertRecord, parseCSV } from "./events";
import postgres from "postgres";
import type { CSVRecord } from "./events";
import { getDeviceId } from "./device";
import { createLogger } from "./utils/logger";

export default {
  async queue(batch: MessageBatch<any>, env: any, ctx: ExecutionContext) {
    const logger = createLogger({ executionCtx: ctx });
    logger.info(`Processing batch of ${batch.messages.length} messages`);
    const sql = postgres(env.HYPERDRIVE.connectionString);
    for (const message of batch.messages) {
      const { token, objectKey, fileType, filename } = message.body;
      const messageLogger = createLogger({
        executionCtx: ctx,
        messageId: message.id,
        fileType,
        objectKey,
      });
      messageLogger.info("Processing message", { filename });
      try {
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
          const records = parseCSV(csvText);
          await sql.begin(async (sql) => {
            const insertPromises = records.map((record: CSVRecord) =>
              insertRecord(record, deviceId, sql)
            );
            await Promise.all(insertPromises);
          });
          messageLogger.info("Successfully inserted records");
        } else if (fileType.toLowerCase().includes("jpg")) {
          messageLogger.info("Processing JPG file", { filename });
          let tsData = filename.split("/");
          let ts = tsData[tsData.length - 1].split(".")[0];
          insertMedia(objectKey, deviceId, ts ?? "", sql);
        } else {
          console.log(`Skipping non-CSV file: ${fileType}`);
        }
      } catch (error) {
        console.error("Error during queue processing:", error);
      } finally {
        await sql.end();
      }
    }
    console.log(`Finished processing batch`);
  },
};
