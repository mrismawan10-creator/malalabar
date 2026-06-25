import { config } from "./config.js";
import { buildApp } from "./app.js";

const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: "::" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
