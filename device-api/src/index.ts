import { Hono } from "hono";
const app = new Hono();

app.get("/", (c) => {
  console.log("recieved get");
  return c.text("Hello Cloudflare Workers! 3");
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

export default app;
