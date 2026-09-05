import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 talks to SQLite through a driver adapter rather than a query engine
// binary, so the connection string is handed to better-sqlite3 directly.
// DATABASE_URL is "file:./dev.db", resolved relative to the prisma/ directory
// the same way the CLI resolves it.
const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

function createClient() {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
  });
}

// Next.js dev server hot-reloads modules; without a global cache every reload
// would open another SQLite handle.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
