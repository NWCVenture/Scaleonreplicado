import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  skuCatalogo,
  loteCadastrado,
  transportadoraPadrao,
  user,
} from "./schema";
import { auth } from "../auth";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida. Use npm run db:seed:dev ou db:seed:prod.");
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

// ============================================================
// Users
// ============================================================

const SEED_USERS = [
  { name: "admin", email: "admin@nwc.com", password: "admin123", role: "admin" as const },
  { name: "funcionario", email: "funcionario@nwc.com", password: "func1234", role: "funcionario" as const },
  { name: "igor", email: "igor@nwc.com", password: "12345678", role: "admin" as const },
  { name: "victor", email: "victor@nwc.com", password: "12345678", role: "admin" as const },
  { name: "fellicio", email: "fellicio@nwc.com", password: "12345678", role: "admin" as const },
  { name: "beatriz", email: "beatriz@nwc.com", password: "12345678", role: "funcionario" as const },
];

async function seedUsers() {
  console.log("Seeding users...");
  for (const userData of SEED_USERS) {
    try {
      await auth.api.signUpEmail({
        body: {
          name: userData.name,
          email: userData.email,
          password: userData.password,
        },
      });
      // Update role after creation
      await db
        .update(user)
        .set({ role: userData.role })
        .where(eq(user.email, userData.email));
      console.log(`  Created user: ${userData.email} (${userData.role})`);
    } catch (err) {
      console.log(`  User ${userData.email} already exists or error:`, (err as Error).message ?? err);
    }
  }
  console.log("Users seeded.");
}

// ============================================================
// SKUs
// ============================================================

function generateDefaultSkus(): string[] {
  const PRODUCTS = ["LUA", "SOL", "PUFFER", "NBA", "CJ"];
  const COLORS = ["AZ", "BR", "PT", "CZ"];
  const SIZES = ["P", "M", "G", "GG", "EGG"];
  const PRODUCTS_SEM_COR = ["PUFFER"];
  const skus: string[] = [];

  for (const product of PRODUCTS) {
    if (PRODUCTS_SEM_COR.includes(product)) {
      for (const size of SIZES) {
        skus.push(`${product} ${size}`);
      }
    } else {
      for (const color of COLORS) {
        for (const size of SIZES) {
          skus.push(`${product} ${color} ${size}`);
        }
      }
    }
  }
  return skus;
}

async function seedSkus() {
  const skus = generateDefaultSkus();
  console.log(`Seeding ${skus.length} SKUs...`);
  for (const codigo of skus) {
    await db
      .insert(skuCatalogo)
      .values({
        id: crypto.randomUUID(),
        codigo,
      })
      .onConflictDoNothing();
  }
  console.log("SKUs seeded.");
}

// ============================================================
// Lotes
// ============================================================

async function seedLotes() {
  console.log("Seeding default lotes...");
  await db
    .insert(loteCadastrado)
    .values({
      id: crypto.randomUUID(),
      nome: "ESTOQUE PADRAO",
    })
    .onConflictDoNothing();
  console.log("Lotes seeded.");
}

// ============================================================
// Carrier patterns
// ============================================================

async function seedCarriers() {
  console.log("Seeding carrier patterns...");
  await db
    .insert(transportadoraPadrao)
    .values([
      {
        id: crypto.randomUUID(),
        transportadora: "TTK-JDLOG",
        prefixos: [],
      },
      {
        id: crypto.randomUUID(),
        transportadora: "TTK-IMILE",
        prefixos: [],
      },
    ])
    .onConflictDoNothing();
  console.log("Carrier patterns seeded.");
}

// ============================================================
// Main
// ============================================================

async function seed() {
  console.log("Seeding database...");

  await seedUsers();
  await seedSkus();
  await seedLotes();
  await seedCarriers();

  console.log("Seed complete!");
  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
