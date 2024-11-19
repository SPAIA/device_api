import { insertMedia, insertRecord, parseCSV } from "./events";
import postgres from "postgres";
import type { CSVRecord } from "./events";
import { getDeviceId } from "./device";

export default {
  async queue(batch: MessageBatch<any>, env: any, ctx: ExecutionContext) {
    console.log(`Processing batch of ${batch.messages.length} messages`);
    const sql = postgres(env.HYPERDRIVE.connectionString);
    for (const message of batch.messages) {
      console.log(`Processing message: ${JSON.stringify(message.body)}`);
      const { token, objectKey, fileType, filename } = message.body;

      try {
        console.log(`Getting device ID for token: ${token}`);
        const deviceId = await getDeviceId(token, sql);
        console.log(`Device ID: ${deviceId}`);
        const fileResponse = await env.BUCKET.get(objectKey);
        if (!fileResponse) {
          console.error("File not found in R2:", objectKey);
          continue;
        }
        if (fileType.toLowerCase().includes("csv")) {
          console.log(`Fetching CSV file from R2: ${objectKey}`);

          const csvText = await fileResponse.text();
          console.log(`Parsing CSV file`);
          const records = parseCSV(csvText);
          console.log(`Parsed ${records.length} records from CSV`);

          console.log(`Inserting records into database`);
          await sql.begin(async (sql) => {
            const insertPromises = records.map((record: CSVRecord) =>
              insertRecord(record, deviceId, sql)
            );
            await Promise.all(insertPromises);
          });

          console.log(`Successfully inserted records for device: ${deviceId}`);
        } else if (fileType.toLowerCase().includes("jpg")) {
          console.log("processing jpg", filename);
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
