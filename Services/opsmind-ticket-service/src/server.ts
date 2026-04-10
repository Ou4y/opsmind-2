import bootstrap from "./app";
import { config } from "./config";
import { logger } from "./config/logger";

bootstrap().then((app) => {
  app.listen(config.port, () => {
    logger.info(`Ticket Service running on port ${config.port}`, {
      env: config.env,
      port: config.port,
    });
  });
});
