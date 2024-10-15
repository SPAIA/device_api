import { Hono } from "hono";
import postgres from "postgres";

export interface Env {
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
app.post("/image", async (c) => {
  console.log("recieved post 1");
  try {
    // Get the image from the request
    const formData = await c.req.formData();
    console.log(formData);
    const image = formData.get("file") as File;
    console.log("image", image.type);
    console.log("image", image.size);
    if (!image) {
      return c.text("No file uploaded", 400);
    }

    // Check file type (you can expand this for security)
    const fileType = image.type;
    if (!["image/jpeg", "image/png"].includes(fileType)) {
      return c.text("Unsupported file type", 400);
    }

    // Store in Cloudflare R2
    const objectKey = `uploads/${crypto.randomUUID()}.${
      fileType.split("/")[1]
    }`;
    const r2Response = await c.env.BUCKET.put(objectKey, image.stream(), {
      httpMetadata: {
        contentType: fileType,
      },
    });

    return c.json({
      message: "File uploaded successfully",
      key: objectKey,
    });
  } catch (error) {
    console.error("Upload error:", error);
    console.log("Upload error:", error);
    return c.text("File upload failed 2", 500);
  }
});
app.post("/upload", async (c) => {
  console.log("recieved post 2");
  try {
    // Get the image from the request
    const formData = await c.req.formData();
    console.log(formData);
    const file = formData.get("file") as File;
    if (!file) {
      return c.text("No file uploaded", 400);
    }
    console.log("file type", file.type);
    console.log("file", file);

    // Check file type (you can expand this for security)
    const fileType = file.type;
    if (!["image/jpeg", "image/png", "text/csv"].includes(fileType)) {
      return c.text("Unsupported file type: " + file.type, 400);
    }

    // Store in Cloudflare R2
    const objectKey = `uploads/${crypto.randomUUID()}.${
      fileType.split("/")[1]
    }`;
    const r2Response = await c.env.BUCKET.put(objectKey, file.stream(), {
      httpMetadata: {
        contentType: fileType,
      },
    });

    return c.json({
      message: "File uploaded successfully",
      key: objectKey,
    });
  } catch (error) {
    console.error("Upload error:", error);
    console.log("Upload error:", error);
    return c.text("File upload failed 2", 500);
  }
});

export default app;
