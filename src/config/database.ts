import { PrismaClient } from "@prisma/client";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

// Only initialize Prisma when a DATABASE_URL is provided to avoid dev-time crashes.
export const db: PrismaClient = hasDatabaseUrl ? new PrismaClient() : ({} as PrismaClient);

if (hasDatabaseUrl) {
	process.on("beforeExit", async () => {
		await db.$disconnect();
	});
} else {
	// eslint-disable-next-line no-console
	console.warn("DATABASE_URL is not set; database client is disabled for this run.");
}
