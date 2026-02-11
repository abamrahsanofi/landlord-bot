const { PrismaClient, MaintenanceStatus } = require('@prisma/client');

const prisma = new PrismaClient();

const statusEnv = process.env.STATUS;
const status = statusEnv ? MaintenanceStatus[statusEnv.toUpperCase()] : undefined;
const days = Number(process.env.DAYS || '30');
const limit = Number(process.env.LIMIT || '20');

const where = {};
if (status) where.status = status;
if (!Number.isNaN(days) && days > 0) {
  where.createdAt = { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
}

(async () => {
  try {
    const rows = await prisma.maintenanceRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        tenant: { select: { id: true, name: true, phone: true, email: true } },
        unit: { select: { id: true, label: true, address: true } },
        utilityBills: {
          select: {
            id: true,
            utilityType: true,
            amountCents: true,
            currency: true,
            anomalyFlag: true,
            anomalyNotes: true,
            billingPeriodStart: true,
            billingPeriodEnd: true,
          },
        },
      },
    });
    console.dir(rows, { depth: null });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
})();
