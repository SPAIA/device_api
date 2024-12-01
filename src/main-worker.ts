import { Hono } from "hono";
import postgres from "postgres";
import queueWorker from "./queue-worker";

export interface Env {
  MY_QUEUE: any;
  HYPERDRIVE: Hyperdrive;
  BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  console.log("recieved get");
  return c.text("Hello Cloudflare Workers! 3");
});
app.get("/test", async (c) => {
  try {
    const sql = postgres(c.env.HYPERDRIVE.connectionString);

    // Check if the Devices table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'Devices'
      );
    `;

    if (!tableCheck[0].exists) {
      return c.json({ error: "Devices table does not exist" });
    }

    // Try to select from the Devices table
    try {
      const results = await sql`SELECT * FROM "Devices" LIMIT 5`;
      await sql.end();
      return c.json(results);
    } catch (queryError) {
      // If the select fails, check permissions
      const permissionCheck = await sql`
        SELECT grantee, privilege_type 
        FROM information_schema.role_table_grants 
        WHERE table_name = 'Devices';
      `;
      await sql.end();
      return c.json({
        error: "Failed to query Devices table",
        details:
          queryError instanceof Error ? queryError.message : String(queryError),
        permissions: permissionCheck,
      });
    }
  } catch (error) {
    console.error("Database query error:", error);
    return c.json(
      {
        error: "Database query failed",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

app.post("/upload", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.text("No device token", 401);
  }
  const token = authHeader.replace("Bearer ", "");

  try {
    // Get the file from the request
    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return c.text("No file uploaded", 400);
    }

    const fileType = file.name.split(".")[1];
    if (!["jpg", "png", "csv", "text/csv"].includes(fileType.toLowerCase())) {
      console.log("unsuportes", fileType);
      console.log("unsuportes", file.name);
      return c.text("Unsupported file type: " + file.type, 400);
    }

    // Store in Cloudflare R2 immediately
    const objectKey = `uploads/${crypto.randomUUID()}.${fileType}`;
    console.log("uploaded file", objectKey);
    console.log("filename", file.name);
    const filename = file.name;
    const r2Response = await c.env.BUCKET.put(objectKey, file.stream());
    if (fileType.toLowerCase() == "csv" || fileType.toLowerCase() == "jpg") {
      console.log("Sending message to queue:", { token, objectKey, fileType });
      await c.env.MY_QUEUE.send({
        token,
        objectKey,
        fileType,
        filename,
      });
      console.log("Message sent to queue successfully");
    } else {
      console.log("ft", fileType.toLowerCase());
    }

    return c.json({
      message: "File upload successful, processing enqueued...",
      key: objectKey,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return c.text(`File upload failed: ${error.message}`, 500);
  }
});

export default {
  fetch: app.fetch,
  queue: queueWorker.queue,
};
