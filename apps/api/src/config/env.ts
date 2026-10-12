import dotenv from "dotenv";
import { z } from "zod";
import * as path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
});

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
