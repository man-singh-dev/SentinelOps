import dotenv from "dotenv";
import { z } from "zod";
import * as path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
});
console.log("PORT FROM ENV:", process.env.PORT);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
});

export const env = envSchema.parse(process.env);