import "server-only";

export class DatabaseUnavailableError extends Error {
  constructor(message = "数据库连接暂时不可用，请稍后重试", options?: { cause?: unknown }) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.cause = options?.cause;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientDatabaseError(error: unknown) {
  if (error instanceof DatabaseUnavailableError) return true;
  const record = error && typeof error === "object" ? error as { name?: string; code?: string; message?: string } : {};
  const message = `${record.name || ""} ${record.code || ""} ${record.message || ""}`;
  return /PrismaClientInitializationError|P1001|P1002|P1017|P2024|Can't reach database server|Timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|Connection terminated|Server has closed the connection/i.test(message);
}

export function isDatabaseUnavailableError(error: unknown) {
  return error instanceof DatabaseUnavailableError || isTransientDatabaseError(error);
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; delaysMs?: number[] } = {}
) {
  const retries = options.retries ?? 2;
  const delaysMs = options.delaysMs ?? [300, 800];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDatabaseError(error)) throw error;
      lastError = error;
      if (attempt >= retries) break;
      await sleep(delaysMs[attempt] ?? delaysMs[delaysMs.length - 1] ?? 500);
    }
  }

  throw new DatabaseUnavailableError("数据库连接暂时不可用，请稍后重试", { cause: lastError });
}

export function databaseUnavailableBody() {
  return {
    ok: false,
    errorType: "database_unavailable",
    message: "数据库连接暂时不可用，请稍后重试"
  };
}
