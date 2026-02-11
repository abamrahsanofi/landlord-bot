const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const rows = await prisma.maintenanceRequest.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });
  console.log(rows);
  await prisma.$disconnect();
})();
