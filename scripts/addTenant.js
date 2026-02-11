const { PrismaClient } = require('../node_modules/@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.upsert({
      where: { phone: '19055378581' },
      update: { name: 'Tenant WhatsApp', phone: '19055378581' },
      create: { name: 'Tenant WhatsApp', phone: '19055378581' },
    });
    console.log('Upserted tenant:', tenant);
  } catch (err) {
    console.error('Failed to upsert tenant', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
