const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const unit = await prisma.unit.upsert({
      where: { id: '79_hearth_upstairs' },
      update: {},
      create: {
        id: '79_hearth_upstairs',
        label: '79 Hearth Upstairs',
        address: '79 Hearth St, Upstairs',
      },
    });

    const tenant = await prisma.tenant.upsert({
      where: { id: 'Nov-2025' },
      update: {},
      create: {
        id: 'Nov-2025',
        name: 'Tenant Nov-2025',
        phone: null,
        email: null,
      },
    });

    console.log({ unit, tenant });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
})();
