import { Logtail } from "@logtail/edge";
import type { ExecutionContext } from "@cloudflare/workers-types";

export const baseLogger = new Logtail("gYpMg6rF5Fg6WZF6DqSG5hzm");

export interface LogContext {
  executionCtx?: ExecutionContext;
  deviceId?: number;
  messageId?: string;
  fileType?: string;
  objectKey?: string;
}

export const createLogger = (context: LogContext = {}) => {
  let logger = baseLogger;

  // Remove the withExecutionContext call since it's causing type issues
  // Instead, we'll include the execution context in the metadata

  return {
    debug: (message: string, meta = {}) => {
      logger.debug(message, {
        ...meta,
        ...context,
        executionCtx: undefined, // Remove ExecutionContext from logs as it's not serializable
      });
    },
    info: (message: string, meta = {}) => {
      logger.info(message, {
        ...meta,
        ...context,
        executionCtx: undefined,
      });
    },
    warn: (message: string, meta = {}) => {
      logger.warn(message, {
        ...meta,
        ...context,
        executionCtx: undefined,
      });
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
        executionCtx: undefined,
        error: errorDetails,
      });
    },
  };
};
