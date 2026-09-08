import { buildApp } from "./app.js";

const port = Number(process.env.KNOWT_PORT ?? 4318);
const app = await buildApp({ logger: true, watchInbox: true });

try {
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
