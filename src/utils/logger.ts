import { Logtail } from "@logtail/edge";
import type { ExecutionContext } from "@cloudflare/workers-types";

const baseLogger = new Logtail("afLXvMoZuY9nWS24kEmq6Wfu");

export interface LogContext {
  deviceId?: number;
  messageId?: string;
  fileType?: string;
  objectKey?: string;
  timestamp?: string;
  operation?: string;
}

export const createLogger = (
  ctx: ExecutionContext,
  context: LogContext = {}
) => {
  // Create a logger instance with the execution context
  const logger = baseLogger.withExecutionContext(ctx);

  return {
    debug: (message: string, meta = {}) => {
      logger.debug(message, { ...meta, ...context });
    },
    info: (message: string, meta = {}) => {
      logger.info(message, { ...meta, ...context });
    },
    warn: (message: string, meta = {}) => {
      logger.warn(message, { ...meta, ...context });
    },
    error: (message: string, error?: any, meta = {}) => {
      const errorDetails =
        error instanceof Error
          ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
          : error;

      logger.error(message, {
        ...meta,
        ...context,
        error: errorDetails,
      });
    },
  };
};
