import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  SUPABASE_URL: z.string().url(),

  SUPABASE_SECRET_KEY: z.string().min(20),

  PHONE_SETUP_KEY: z.string().optional(),

  PHONESYNC_CLI_TOKEN: z.string().optional(),

  PHONESYNC_OWNER_ID: z.string().optional(),
  REGISTRATION_KEY: z.string().optional(),

  CORS_ORIGIN: z.string().optional(),
});

export const env = schema.parse(process.env);
