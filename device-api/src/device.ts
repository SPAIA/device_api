import { Context } from "hono";
import postgres from "postgres";

const getDeviceId = async (identifier: string, sql: any): Promise<number> => {
  const result = await sql`
        SELECT id FROM "Devices"
        WHERE "serial" = ${identifier};
    `;

  if (!result.length || !result[0].id) {
    return -1;
  }

  return result[0].id as number;
};

export { getDeviceId };
