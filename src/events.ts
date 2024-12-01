import postgres from "postgres";
import { Context } from "hono";
import { Logtail } from "@logtail/edge";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { createLogger } from "./utils/logger";

export interface CSVRecord {
  timestamp: string;
  temperature: string;
  humidity: string;
  pressure: string;
  bboxes: string;
}

const parseCSV = (csvText: string, ctx: ExecutionContext): CSVRecord[] => {
  const logger = createLogger(ctx, { operation: "parseCSV" });

  // Split into lines
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",") as (keyof CSVRecord)[];

  if (!headers) {
    logger.warn("No headers found in CSV");
    return [];
  }

  logger.debug("Parsing CSV", { headerCount: headers.length });

  const records = lines.slice(1).map((line, index) => {
    // Find the last comma before any JSON content
    const lastCommaBeforeJson = line.lastIndexOf(",", line.indexOf("["));

    // Split the non-JSON part normally
    const regularFields = line.slice(0, lastCommaBeforeJson).split(",");

    // Get the JSON part (if it exists)
    const jsonPart = line.slice(lastCommaBeforeJson + 1);

    const record: Partial<CSVRecord> = {};

    // Assign regular fields
    headers.slice(0, -1).forEach((header, idx) => {
      record[header] = regularFields[idx] || "";
    });

    // Handle the bboxes field
    record.bboxes = jsonPart || "";

    // Validate and clean JSON if present
    if (record.bboxes && record.bboxes.trim()) {
      try {
        // Parse and re-stringify to ensure valid JSON
        const parsed = JSON.parse(record.bboxes);
        record.bboxes = JSON.stringify(parsed);
      } catch (e) {
        logger.warn("Failed to parse JSON field", {
          value: record.bboxes,
          error: e instanceof Error ? e.message : "Unknown error",
          lineNumber: index + 2,
        });
      }
    }

    return record as CSVRecord;
  });

  logger.info("CSV parsing complete", { recordCount: records.length });
  return records;
};

// Helper function to validate bboxes format
const validateBboxes = (bboxes: string): boolean => {
  if (!bboxes) return true; // Empty string is valid

  try {
    const parsed = JSON.parse(bboxes);
    if (!Array.isArray(parsed)) return false;

    return parsed.every(
      (box) =>
        typeof box === "object" &&
        typeof box.x_min === "number" &&
        typeof box.y_min === "number" &&
        typeof box.x_max === "number" &&
        typeof box.y_max === "number"
    );
  } catch {
    return false;
  }
};

const sensorIds: Record<string, number> = {
  temperature: 1,
  humidity: 2,
  pressure: 3,
};

const getSensorId = (valueName: string): number | null => {
  return sensorIds[valueName.toLowerCase()] || null;
};

const insertRecord = async (
  record: CSVRecord,
  deviceId: number,
  sql: any,
  ctx: ExecutionContext
) => {
  const logger = createLogger(ctx, {
    deviceId,
    timestamp: record.timestamp,
    operation: "insertRecord",
  });

  try {
    logger.debug("Inserting event record");
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
    logger.info("Event record inserted", { eventId });

    for (const key in record) {
      if (key === "timestamp") continue;

      if (
        key.toLowerCase() === "bboxes" &&
        record[key] &&
        typeof record[key] === "string"
      ) {
        try {
          const boxString = record[key] as string;
          logger.info("Parsing bbox string", boxString);
          const boxes = JSON.parse(boxString);
          logger.debug("Parsed bboxes", { boxes });

          for (const box of boxes) {
            if (
              box.x_min !== undefined &&
              box.y_min !== undefined &&
              box.x_max !== undefined &&
              box.y_max !== undefined
            ) {
              const width = box.x_max - box.x_min;
              const height = box.y_max - box.y_min;
              const x = box.x_min;
              const y = box.y_min;

              logger.debug("Inserting region", { width, height, x, y });

              await sql`
                INSERT INTO "Regions" (
                  "eventId",
                  "w",
                  "h",
                  "x",
                  "y",
                  "createdAt",
                  "updatedAt"
                ) VALUES (
                  ${eventId},
                  ${width},
                  ${height},
                  ${x},
                  ${y},
                  NOW(),
                  NOW()
                )
              `;
            } else {
              logger.warn("Invalid bounding box data", { box });
            }
          }
        } catch (error) {
          logger.error("Failed to parse or insert bboxes", error);
        }
      }

      const sensorId = getSensorId(key);
      if (sensorId !== null && record[key] !== undefined) {
        try {
          logger.debug("Inserting sensor data", {
            sensorId,
            sensorType: key,
            value: record[key],
          });

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
        } catch (error) {
          logger.error(`Error inserting sensor data`, error, {
            sensorType: key,
            sensorId,
          });
        }
      } else if (sensorId === null) {
        logger.warn("Unknown sensor type", {
          sensorType: key,
          value: record[key],
        });
      }
    }
  } catch (error) {
    logger.error("Failed to insert record", error);
    throw error;
  }
};

const insertMedia = async (
  fileId: string,
  deviceId: number,
  time: string,
  sql: any,
  ctx: ExecutionContext
) => {
  const logger = createLogger(ctx, {
    deviceId,
    fileId,
    timestamp: time,
    operation: "insertMedia",
  });

  try {
    logger.debug("Beginning media insertion transaction");

    const result = await sql.begin(async (sql: any) => {
      logger.debug("Inserting event record", { time });

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

      logger.debug("Event record inserted/updated", {
        eventId: eventResult.id,
      });

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

      logger.info("Media record inserted successfully", {
        eventId: eventResult.id,
        mediaId: mediaResult.id,
      });

      return mediaResult;
    });

    return result;
  } catch (error) {
    logger.error("Failed to insert media", error);
    throw error;
  }
};

export { parseCSV, insertRecord, insertMedia, validateBboxes };
