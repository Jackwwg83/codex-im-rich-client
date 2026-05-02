import { join } from "node:path";
import pino, { type Logger } from "pino";

const DEFAULT_LOGGER_NAME = "codex-im-daemon";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_RETENTION_COUNT = 14;

export interface DaemonPinoLoggerOptions {
  readonly level: string;
  readonly name: string;
}

export interface DaemonPinoRollTransportConfig {
  readonly target: "pino-roll";
  readonly options: {
    readonly file: string;
    readonly frequency: "daily";
    readonly mkdir: true;
    readonly limit: {
      readonly count: number;
    };
  };
}

export interface DaemonStdoutLoggerPlan {
  readonly mode: "stdout";
  readonly loggerOptions: DaemonPinoLoggerOptions;
}

export interface DaemonRotatingFileLoggerPlan {
  readonly mode: "rotating-file";
  readonly loggerOptions: DaemonPinoLoggerOptions;
  readonly transport: DaemonPinoRollTransportConfig;
}

export type DaemonLoggerPlan = DaemonStdoutLoggerPlan | DaemonRotatingFileLoggerPlan;
export type DaemonTransportFactory = (config: DaemonPinoRollTransportConfig) => unknown;
export type DaemonPinoFactory<TLogger> = (
  options: DaemonPinoLoggerOptions,
  stream?: unknown,
) => TLogger;

export interface DaemonLoggerPlanOptions {
  readonly env?: Record<string, string | undefined>;
  readonly home?: string;
  readonly logDir?: string;
  readonly name?: string;
  readonly level?: string;
  readonly retentionCount?: number;
}

export interface DaemonLoggerOptions<TLogger = Logger> extends DaemonLoggerPlanOptions {
  readonly pinoFactory?: DaemonPinoFactory<TLogger>;
  readonly transportFactory?: DaemonTransportFactory;
}

export function planDaemonLogger(options: DaemonLoggerPlanOptions = {}): DaemonLoggerPlan {
  const env = options.env ?? process.env;
  const level = options.level ?? env.CODEX_IM_LOG_LEVEL ?? DEFAULT_LOG_LEVEL;
  const name = options.name ?? DEFAULT_LOGGER_NAME;

  if (logRotationDisabled(env)) {
    return {
      mode: "stdout",
      loggerOptions: {
        level: env.NODE_ENV === "test" ? "silent" : level,
        name,
      },
    };
  }

  const logDir = options.logDir ?? defaultLogDir(options.home ?? env.HOME);
  return {
    mode: "rotating-file",
    loggerOptions: {
      level,
      name,
    },
    transport: {
      target: "pino-roll",
      options: {
        file: join(logDir, "daemon.log"),
        frequency: "daily",
        mkdir: true,
        limit: {
          count: options.retentionCount ?? DEFAULT_RETENTION_COUNT,
        },
      },
    },
  };
}

export function createDaemonLogger<TLogger = Logger>(
  options: DaemonLoggerOptions<TLogger> = {},
): TLogger {
  const plan = planDaemonLogger(options);
  const pinoFactory =
    options.pinoFactory ?? (defaultPinoFactory as unknown as DaemonPinoFactory<TLogger>);

  if (plan.mode === "stdout") {
    return pinoFactory(plan.loggerOptions);
  }

  const transportFactory = options.transportFactory ?? defaultTransportFactory;
  return pinoFactory(plan.loggerOptions, transportFactory(plan.transport));
}

function logRotationDisabled(env: Record<string, string | undefined>): boolean {
  return (
    env.CODEX_IM_LOG_ROTATION === "0" || env.NODE_ENV === "test" || env.NODE_ENV === "development"
  );
}

function defaultLogDir(home: string | undefined): string {
  if (home === undefined || home.length === 0) {
    throw new Error("daemon logger requires HOME or logDir when log rotation is enabled");
  }
  return join(home, ".codex-im-bridge", "logs");
}

const defaultTransportFactory: DaemonTransportFactory = (config) => pino.transport(config);

const defaultPinoFactory: DaemonPinoFactory<Logger> = (options, stream) => {
  if (stream === undefined) {
    return pino(options);
  }
  return (pino as unknown as DaemonPinoFactory<Logger>)(options, stream);
};
