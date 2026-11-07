import { prisma } from "@/lib/prisma";

// Seed a demo catalog so the storefront shows products locally with zero credentials.
export async function seed() {
  console.log("Seeding demo catalog...");

  // Create demo users (customers, vendors, admin)
  const adminUser = await prisma.user.upsert({
    where: { usersId: "usr_admin_001" },
    update: {},
    create: {
      id: "user_admin_001",
      usersId: "usr_admin_001",
      email: "admin@commerce.local",
      name: "Admin",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const vendorUser1 = await prisma.user.upsert({
    where: { usersId: "usr_vendor_001" },
    update: {},
    create: {
      id: "user_vendor_001",
      usersId: "usr_vendor_001",
      email: "vendor1@commerce.local",
      name: "Vendor One",
      role: "VENDOR",
      status: "ACTIVE",
    },
  });

  const vendorUser2 = await prisma.user.upsert({
    where: { usersId: "usr_vendor_002" },
    update: {},
    create: {
      id: "user_vendor_002",
      usersId: "usr_vendor_002",
      email: "vendor2@commerce.local",
      name: "Vendor Two",
      role: "VENDOR",
      status: "ACTIVE",
    },
  });

  const customerUser = await prisma.user.upsert({
    where: { usersId: "usr_customer_001" },
    update: {},
    create: {
      id: "user_customer_001",
      usersId: "usr_customer_001",
      email: "customer@commerce.local",
      name: "Demo Customer",
      role: "CUSTOMER",
      status: "ACTIVE",
    },
  });

  // Create demo vendors
  const vendor1 = await prisma.vendor.upsert({
    where: { userId: vendorUser1.id },
    update: {},
    create: {
      userId: vendorUser1.id,
      businessName: "Acme Electronics",
      description: "Your trusted source for premium electronics and gadgets.",
      status: "ACTIVE",
    },
  });

  const vendor2 = await prisma.vendor.upsert({
    where: { userId: vendorUser2.id },
    update: {},
    create: {
      userId: vendorUser2.id,
      businessName: "GreenLeaf Home Goods",
      description: "Sustainable home goods for everyday living.",
      status: "ACTIVE",
    },
  });

  // Create demo products
  const products = await Promise.all([
    prisma.product.upsert({
      where: { id: "prod_001" },
      update: {},
      create: {
        id: "prod_001",
        vendorId: vendor1.id,
        name: "Wireless Bluetooth Headphones",
        description: "Premium noise-cancelling wireless headphones with 30-hour battery life. Deep bass, crystal-clear calls, and ultra-comfortable ear cushions.",
        basePrice: 7999, // $79.99
        category: "Electronics",
        imageUrl: "/demo/headphones.jpg",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_002" },
      update: {},
      create: {
        id: "prod_002",
        vendorId: vendor1.id,
        name: "USB-C Hub 7-in-1",
        description: "Compact USB-C hub with HDMI 4K, 3x USB 3.0, SD/TF card reader, and 100W PD charging pass-through.",
        basePrice: 3499, // $34.99
        category: "Electronics",
        imageUrl: "/demo/usb-hub.jpg",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_003" },
      update: {},
      create: {
        id: "prod_003",
        vendorId: vendor1.id,
        name: "Mechanical Keyboard RGB",
        description: "Full-size mechanical keyboard with Cherry MX Blue switches, per-key RGB backlighting, and aircraft-grade aluminum frame.",
        basePrice: 12999, // $129.99
        category: "Electronics",
        imageUrl: "/demo/keyboard.jpg",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_004" },
      update: {},
      create: {
        id: "prod_004",
        vendorId: vendor2.id,
        name: "Organic Cotton Towel Set",
        description: "Set of 4 plush organic cotton bath towels. GOTS certified, 700 GSM, quick-dry. Available in natural dye colors.",
        basePrice: 5499, // $54.99
        category: "Home",
        imageUrl: "/demo/towels.jpg",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_005" },
      update: {},
      create: {
        id: "prod_005",
        vendorId: vendor2.id,
        name: "Bamboo Kitchen Utensil Set",
        description: "10-piece bamboo kitchen utensil set with holder. Naturally antimicrobial, heat-resistant to 400°F, and sustainably harvested.",
        basePrice: 2999, // $29.99
        category: "Home",
        imageUrl: "/demo/utensils.jpg",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_006" },
      update: {},
      create: {
        id: "prod_006",
        vendorId: vendor2.id,
        name: "Recycled Glass Vase",
        description: "Hand-blown recycled glass vase. Each piece is unique. 10\" tall, dishwasher safe. Fair Trade certified.",
        basePrice: 3999, // $39.99
        category: "Home",
        imageUrl: "/demo/vase.jpg",
      },
    }),
  ]);

  // Create variants for the headphones
  await prisma.variant.upsert({
    where: { sku: "HP-001-BLK" },
    update: {},
    create: { productId: "prod_001", name: "Black", sku: "HP-001-BLK", price: 7999, stock: 50 },
  });
  await prisma.variant.upsert({
    where: { sku: "HP-001-WHT" },
    update: {},
    create: { productId: "prod_001", name: "White", sku: "HP-001-WHT", price: 7999, stock: 30 },
  });
  await prisma.variant.upsert({
    where: { sku: "HP-001-NAV" },
    update: {},
    create: { productId: "prod_001", name: "Navy", sku: "HP-001-NAV", price: 8499, stock: 20 },
  });

  console.log(`Seeded: ${products.length} products, 2 vendors, 3 users`);
}

// Run if called directly
seed()
  .then(() => {
    console.log("Seed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
