// Seed a demo catalog so the storefront shows products locally.
// Run with: npm run db:seed   (requires a reachable DATABASE_URL)
//
// This seeds the DATABASE. The zero-credential storefront path reads the same
// demo catalog from src/lib/catalog.ts without a database; keep the two in sync.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const vendor = await prisma.vendor.upsert({
    where: { id: "demo-vendor" },
    update: {},
    create: {
      id: "demo-vendor",
      name: "Cannabis Farmers Co-op",
      state: "CA",
      licences: {
        create: {
          licenceNumber: "C10-0000000-LIC",
          issuingState: "CA",
          licenceType: "Cultivation",
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          verificationStatus: "VERIFIED",
          verifiedAt: new Date(),
        },
      },
    },
  });

  const products = [
    {
      name: "Blue Dream",
      category: "flower",
      thc: 18.0,
      cbd: 0.2,
      variants: [
        { sku: "BD-1G", name: "1g eighth", weightMg: 1000, priceCents: 1500 },
        { sku: "BD-35G", name: "3.5g jar", weightMg: 3500, priceCents: 4500 },
      ],
    },
    {
      name: "Sour Diesel",
      category: "flower",
      thc: 20.5,
      cbd: 0.1,
      variants: [
        { sku: "SD-1G", name: "1g", weightMg: 1000, priceCents: 1400 },
        { sku: "SD-7G", name: "7g bag", weightMg: 7000, priceCents: 8000 },
      ],
    },
    {
      name: "ACDC CBD Tincture",
      category: "tincture",
      thc: 0.3,
      cbd: 25.0,
      variants: [{ sku: "ACDC-T30", name: "30ml tincture", weightMg: 30000, priceCents: 3500 }],
    },
    {
      name: "Gelato Pre-rolls",
      category: "pre-roll",
      thc: 22.0,
      cbd: 0.1,
      variants: [{ sku: "GEL-PR5", name: "5-pack pre-rolls", weightMg: 2500, priceCents: 3000 }],
    },
    {
      name: "OG Kush Distillate Cartridge",
      category: "vape",
      thc: 85.0,
      cbd: 0.0,
      variants: [{ sku: "OGK-C1", name: "1g cartridge", weightMg: 1000, priceCents: 5500 }],
    },
    {
      name: "Wholesale Flower Bulk (Indica)",
      category: "wholesale-flower",
      thc: 19.0,
      cbd: 0.2,
      variants: [{ sku: "WF-BULK-1LB", name: "1 lb bulk", weightMg: 453592, priceCents: 120000 }],
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: `demo-${p.sku ?? p.name}` },
      update: {},
      create: {
        id: `demo-${p.sku ?? p.name}`,
        vendorId: vendor.id,
        name: p.name,
        category: p.category,
        description: `Demo ${p.category} product for local development.`,
        thcPercent: p.thc,
        cbdPercent: p.cbd,
        variants: {
          create: p.variants.map((v) => ({
            sku: v.sku,
            name: v.name,
            weightMilligrams: v.weightMg,
            priceCents: BigInt(v.priceCents),
            inventory: { create: { quantity: 100 } },
          })),
        },
      },
    });
  }

  console.log("Seeded demo vendor and catalog.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
