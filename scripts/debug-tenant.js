const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Get all landlords
  const landlords = await p.landlord.findMany({
    select: {
      id: true,
      email: true,
      evolutionInstanceName: true,
      nestmindBotInstance: true,
      whatsappNumbers: true,
      plan: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log("=== LANDLORDS ===");
  console.log(JSON.stringify(landlords, null, 2));

  // Get all tenants
  const tenants = await p.tenant.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      landlordId: true,
      autoReplyEnabled: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log("\n=== TENANTS ===");
  console.log(JSON.stringify(tenants, null, 2));

  // Check auto-reply app settings
  const settings = await p.appSetting.findMany({
    where: { key: { in: ['global_auto_reply_enabled', 'global_auto_reply_delay_minutes', 'global_auto_reply_cooldown_minutes'] } },
  });
  console.log("\n=== AUTO-REPLY SETTINGS ===");
  console.log(JSON.stringify(settings, null, 2));

  // Check maintenance requests
  const requests = await p.maintenanceRequest.findMany({
    select: {
      id: true,
      tenantId: true,
      landlordId: true,
      status: true,
      message: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log("\n=== RECENT MAINTENANCE REQUESTS ===");
  console.log(JSON.stringify(requests, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
