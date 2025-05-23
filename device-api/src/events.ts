import postgres from "postgres";
import { Context } from "hono";

export type CSVRecord = {
  timestamp: string;
  [key: string]: string | number | undefined;
};

const parseCSV = (csvText: string): CSVRecord[] => {
  const lines = csvText.trim().split("\n");

  // Get headers
  const headers = lines.shift()?.split(",") as (keyof CSVRecord)[];
  if (!headers) return [];

  const records = lines.map((line) => {
    const values = line.split(",");
    const record: Partial<CSVRecord> = {};

    headers.forEach((header, index) => {
      record[header] = values[index] || "";
    });

    return record as CSVRecord; // Type assertion to ensure the record matches CSVRecord
  });

  return records;
};

const sensorIds: Record<string, number> = {
  temperature: 1,
  humidity: 2,
  pressure: 3,
  // Add more sensor types here as needed
};

const getSensorId = (valueName: string): number | null => {
  return sensorIds[valueName.toLowerCase()] || null;
};
const insertRecordB = async (record: CSVRecord, deviceId: number, sql: any) => {
  console.log(`
      INSERT INTO "Events" (
        "time",
        "deviceId",
        "location",
        "createdAt",
        "updatedAt",
        "updatedBy"
      ) VALUES (
        to_timestamp(${record.timestamp}),
        ${deviceId},
        ST_GeomFromText('POINT(30 10)', 4326),
        NOW(),
        NOW(),
        'DEVICE'
      )
    `);
  return sql`
      INSERT INTO "Events" (
        "time",
        "deviceId",
        "location",
        "createdAt",
        "updatedAt",
        "updatedBy"
      ) VALUES (
        to_timestamp(${record.timestamp}),
        ${deviceId},
        ST_GeomFromText('POINT(30 10)', 4326),
        NOW(),
        NOW(),
        'DEVICE'
      )
    `;
};
const insertRecord = async (record: CSVRecord, deviceId: number, sql: any) => {
  // Check if the Devices table exists
  const eventResult = await sql`
    INSERT INTO "Events" (
      "time",
      "deviceId",
      "location",
      "createdAt",
      "updatedAt",
      "updatedBy"
    ) VALUES (
      to_timestamp(${record.timestamp}),
      ${deviceId},
      ST_GeomFromText('POINT(30 10)', 4326),
      NOW(),
      NOW(),
      'DEVICE'
    )
    RETURNING id
  `;

  const eventId = eventResult[0].id;

  // Loop through all keys in the record
  for (const key in record) {
    if (key !== "timestamp") {
      // Skip the timestamp field
      const sensorId = getSensorId(key);
      if (sensorId !== null && record[key] !== undefined) {
        try {
          await sql`
            INSERT INTO "SensorData" (
              "sensorId",
              "eventId",
              "value",
              "createdAt",
              "updatedAt"
            ) VALUES (
              ${sensorId},
              ${eventId},
              ${record[key]},
              NOW(),
              NOW()
            )
          `;
        } catch (error: any) {
          console.error(`Error inserting ${key} data: ${error.message}`);
          // Log the error but continue processing other sensor types
        }
      } else if (sensorId === null) {
        console.warn(
          `Sensor ID not found for ${key}. Skipping this sensor data.`
        );
        console.log("data", record[key]);
      }
    }
  }
};
const insertMedia = async (
  fileId: string,
  deviceId: number,
  time: string,
  sql: any
) => {
  try {
    const result = await sql.begin(async (sql: any) => {
      // First ensure we have the event and get its ID
      console.log("time", time);
      const [eventResult] = await sql`
        INSERT INTO "Events" (
          "time",
          "type",
          "deviceId",
          "createdAt",
          "updatedAt",
          "updatedBy"
        )
        VALUES (
          TO_TIMESTAMP(${time}::bigint),
          'eventType',
          ${deviceId},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          'device'
        )
        ON CONFLICT ("time", "deviceId")
        DO UPDATE SET 
          "updatedAt" = CURRENT_TIMESTAMP,
          "updatedBy" = 'device'
        RETURNING id
      `;
      console.log();
      // Then insert the media record using the event ID
      const [mediaResult] = await sql`
        INSERT INTO "EventMedia" (
          "eventId",
          "fileId",
          "source",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${eventResult.id},
          ${fileId},
          'r2',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING *
      `;

      return mediaResult;
    });

    return result;
  } catch (error: any) {
    console.error(
      `Error inserting media for fileId ${fileId} and deviceId ${deviceId}: ${error.message}`
    );
    throw error; // Re-throw the error to handle it at a higher level
  }
};

export { parseCSV, insertRecord, insertMedia };
