import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { Setting } from "../models/setting.model";

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

const text = (v: unknown, max: number) =>
  String(v ?? "")
    .trim()
    .slice(0, max);

// --- Portada del home ---

export interface HeroSettings {
  /** Si está apagada, el home muestra el collage de fotos de siempre. */
  enabled: boolean;
  image: { url: string; publicId: string };
  eyebrow: string;
  title: string;
  text: string;
  ctaLabel: string;
  ctaLink: string;
}

const HERO_DEFAULT: HeroSettings = {
  enabled: false,
  image: { url: "", publicId: "" },
  eyebrow: "Nueva colección",
  title: "Flores amarillas para regalar",
  text: "Arreglos, peluches y detalles para sorprender a quien más quieres.",
  ctaLabel: "Ver catálogo",
  ctaLink: "/tienda",
};

export async function getHero(): Promise<HeroSettings> {
  requireDb();
  const doc = await Setting.findOne({ key: "hero" }).lean();
  return { ...HERO_DEFAULT, ...((doc?.value as Partial<HeroSettings>) ?? {}) };
}

export async function setHero(input: Partial<HeroSettings>): Promise<HeroSettings> {
  requireDb();
  const current = await getHero();
  const url = text(input.image?.url ?? current.image.url, 500);
  const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
  if (enabled && !/^https?:\/\//.test(url)) {
    throw new CustomError("Elige una imagen para la portada antes de activarla", 400);
  }
  const value: HeroSettings = {
    enabled,
    image: { url, publicId: text(input.image?.publicId ?? current.image.publicId, 200) },
    eyebrow: text(input.eyebrow ?? current.eyebrow, 60),
    title: text(input.title ?? current.title, 120),
    text: text(input.text ?? current.text, 240),
    ctaLabel: text(input.ctaLabel ?? current.ctaLabel, 40) || "Ver catálogo",
    ctaLink: text(input.ctaLink ?? current.ctaLink, 300) || "/tienda",
  };
  await Setting.updateOne({ key: "hero" }, { value }, { upsert: true });
  return value;
}

// --- Métodos de pago que aprueba el equipo ---

export interface BankAccount {
  bank: string;
  type: string;
  number: string;
  holder: string;
  documentId: string;
  email: string;
}

export interface PaymentSettings {
  transfer: { enabled: boolean; accounts: BankAccount[]; instructions: string };
  cash: { enabled: boolean; instructions: string };
}

const PAYMENTS_DEFAULT: PaymentSettings = {
  // Activa desde el arranque: sin cuentas cargadas, el cliente pide los datos por WhatsApp.
  transfer: {
    enabled: true,
    accounts: [],
    instructions:
      "Transfiere el total exacto y pon el número de pedido en la descripción. Luego sube la captura del comprobante aquí mismo.",
  },
  cash: {
    enabled: true,
    instructions:
      "Reservamos tu pedido y pagas en efectivo al retirarlo en la tienda que elegiste.",
  },
};

export async function getPayments(): Promise<PaymentSettings> {
  requireDb();
  const doc = await Setting.findOne({ key: "payments" }).lean();
  const saved = (doc?.value as Partial<PaymentSettings>) ?? {};
  return {
    transfer: { ...PAYMENTS_DEFAULT.transfer, ...(saved.transfer ?? {}) },
    cash: { ...PAYMENTS_DEFAULT.cash, ...(saved.cash ?? {}) },
  };
}

function cleanAccounts(raw: unknown): BankAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => ({
      bank: text(a?.bank, 60),
      type: text(a?.type, 30),
      number: text(a?.number, 40),
      holder: text(a?.holder, 80),
      documentId: text(a?.documentId, 20),
      email: text(a?.email, 80),
    }))
    .filter((a) => a.bank || a.number);
}

export async function setPayments(input: Partial<PaymentSettings>): Promise<PaymentSettings> {
  requireDb();
  const current = await getPayments();
  const accounts =
    input.transfer?.accounts === undefined
      ? current.transfer.accounts
      : cleanAccounts(input.transfer.accounts);
  const transferEnabled =
    input.transfer?.enabled === undefined
      ? current.transfer.enabled
      : Boolean(input.transfer.enabled);
  for (const a of accounts) {
    if (!a.bank || !a.number || !a.holder) {
      throw new CustomError("Cada cuenta necesita banco, número y titular", 400);
    }
  }
  const value: PaymentSettings = {
    transfer: {
      enabled: transferEnabled,
      accounts,
      instructions: text(input.transfer?.instructions ?? current.transfer.instructions, 400),
    },
    cash: {
      enabled:
        input.cash?.enabled === undefined ? current.cash.enabled : Boolean(input.cash.enabled),
      instructions: text(input.cash?.instructions ?? current.cash.instructions, 400),
    },
  };
  await Setting.updateOne({ key: "payments" }, { value }, { upsert: true });
  return value;
}
