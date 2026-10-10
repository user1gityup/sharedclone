// In-memory demo catalog. This is what makes the storefront show products with
// zero credentials and no database. Keep in sync with prisma/seed.ts (the DB
// seed for when a real database is configured).

export interface DemoVariant {
  id: string;
  sku: string;
  name: string;
  weightMilligrams: number;
  unit: string;
  priceCents: number;
  stock: number;
}

export interface DemoProduct {
  id: string;
  vendorId: string;
  vendorName: string;
  name: string;
  category: string;
  description: string;
  thcPercent: number | null;
  cbdPercent: number | null;
  isWholesale: boolean;
  variants: DemoVariant[];
}

export const DEMO_VENDOR = Object.freeze({
  id: "demo-vendor",
  name: "Cannabis Farmers Co-op",
  state: "CA",
});

export const DEMO_PRODUCTS: readonly DemoProduct[] = Object.freeze([
  {
    id: "demo-blue-dream",
    vendorId: "demo-vendor",
    vendorName: "Cannabis Farmers Co-op",
    name: "Blue Dream",
    category: "flower",
    description: "Balanced hybrid flower. Demo catalog entry for local development.",
    thcPercent: 18.0,
    cbdPercent: 0.2,
    isWholesale: false,
    variants: [
      { id: "v-bd-1g", sku: "BD-1G", name: "1g", weightMilligrams: 1000, unit: "g", priceCents: 1500, stock: 40 },
      { id: "v-bd-35g", sku: "BD-35G", name: "3.5g jar", weightMilligrams: 3500, unit: "g", priceCents: 4500, stock: 25 },
    ],
  },
  {
    id: "demo-sour-diesel",
    vendorId: "demo-vendor",
    vendorName: "Cannabis Farmers Co-op",
    name: "Sour Diesel",
    category: "flower",
    description: "Sativa-dominant flower. Demo catalog entry for local development.",
    thcPercent: 20.5,
    cbdPercent: 0.1,
    isWholesale: false,
    variants: [
      { id: "v-sd-1g", sku: "SD-1G", name: "1g", weightMilligrams: 1000, unit: "g", priceCents: 1400, stock: 60 },
      { id: "v-sd-7g", sku: "SD-7G", name: "7g bag", weightMilligrams: 7000, unit: "g", priceCents: 8000, stock: 15 },
    ],
  },
  {
    id: "demo-acdc-tincture",
    vendorId: "demo-vendor",
    vendorName: "Cannabis Farmers Co-op",
    name: "ACDC CBD Tincture",
    category: "tincture",
    description: "High-CBD, low-THC tincture. Demo catalog entry for local development.",
    thcPercent: 0.3,
    cbdPercent: 25.0,
    isWholesale: false,
    variants: [
      { id: "v-acdc-30", sku: "ACDC-T30", name: "30ml tincture", weightMilligrams: 30000, unit: "ml", priceCents: 3500, stock: 30 },
    ],
  },
  {
    id: "demo-gelato-preroll",
    vendorId: "demo-vendor",
    vendorName: "Cannabis Farmers Co-op",
    name: "Gelato Pre-rolls",
    category: "pre-roll",
    description: "Five 0.5g pre-rolls. Demo catalog entry for local development.",
    thcPercent: 22.0,
    cbdPercent: 0.1,
    isWholesale: false,
    variants: [
      { id: "v-gel-pr5", sku: "GEL-PR5", name: "5-pack pre-rolls", weightMilligrams: 2500, unit: "g", priceCents: 3000, stock: 20 },
    ],
  },
  {
    id: "demo-ogk-cartridge",
    vendorId: "demo-vendor",
    vendorName: "Cannabis Farmers Co-op",
    name: "OG Kush Distillate Cartridge",
    category: "vape",
    description: "1g distillate cartridge. Demo catalog entry for local development.",
    thcPercent: 85.0,
    cbdPercent: 0.0,
    isWholesale: false,
    variants: [
      { id: "v-ogk-c1", sku: "OGK-C1", name: "1g cartridge", weightMilligrams: 1000, unit: "g", priceCents: 5500, stock: 18 },
    ],
  },
  {
    id: "demo-wholesale-flower",
    vendorId: "demo-vendor",
    vendorName: "Cannabis Farmers Co-op",
    name: "Wholesale Flower Bulk (Indica)",
    category: "wholesale-flower",
    description: "Bulk flower for licensed wholesale buyers. Demo catalog entry for local development.",
    thcPercent: 19.0,
    cbdPercent: 0.2,
    isWholesale: true,
    variants: [
      { id: "v-wf-bulk-1lb", sku: "WF-BULK-1LB", name: "1 lb bulk", weightMilligrams: 453592, unit: "lb", priceCents: 120000, stock: 8 },
    ],
  },
]);

/** Return the full demo catalog (retail and wholesale). */
export function listProducts(): DemoProduct[] {
  return DEMO_PRODUCTS.map((p) => ({
    ...p,
    variants: p.variants.map((v) => ({ ...v })),
  }));
}

/** Return products visible to retail (non-wholesale) shoppers. */
export function listRetailProducts(): DemoProduct[] {
  return listProducts().filter((p) => !p.isWholesale);
}

/** Return a single product by id, or undefined. */
export function getProduct(id: string): DemoProduct | undefined {
  return listProducts().find((p) => p.id === id);
}

/** Return a single variant by SKU, or undefined. */
export function getVariant(sku: string): DemoVariant | undefined {
  for (const p of DEMO_PRODUCTS) {
    const v = p.variants.find((x) => x.sku === sku);
    if (v) return { ...v };
  }
  return undefined;
}
