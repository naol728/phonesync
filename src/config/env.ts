import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(5000),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  SUPABASE_URL: z.string().url(),

  SUPABASE_SECRET_KEY: z.string().min(20),

  PHONE_SETUP_KEY: z.string(),

  PHONESYNC_CLI_TOKEN: z.string(),

  PHONESYNC_OWNER_ID: z.string(),
  REGISTRATION_KEY: z.string().optional(),

  CORS_ORIGIN: z.string().optional(),
});

export const env = schema.parse(process.env);
