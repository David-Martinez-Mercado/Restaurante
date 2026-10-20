import { randomInt } from "node:crypto";
import { AppError } from "@resto/core";
import type {
  BillingInput,
  CustomerDTO,
  CustomerInternalDTO,
  CustomerProfileInput,
  CustomerSummaryDTO,
  TelegramLinkCodeDTO,
  TelegramLinkInput,
} from "@resto/contracts";
import type { Customer } from "../generated/client/index.js";
import { customerRepository } from "../repositories/customer.repository.js";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;
/** Sin 0/O/1/I para que el código no se confunda al teclearlo. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function billingOf(c: Customer): BillingInput | null {
  if (!c.billingRfc) return null;
  return {
    rfc: c.billingRfc,
    businessName: c.billingBusinessName ?? "",
    postalCode: c.billingPostalCode ?? "",
    taxRegime: c.billingTaxRegime ?? "",
    cfdiUse: c.billingCfdiUse ?? "",
  };
}

function toDTO(c: Customer): CustomerDTO {
  return {
    id: c.id,
    userId: c.userId,
    fullName: c.fullName,
    phone: c.phone,
    telegramLinked: c.telegramChatId !== null,
    telegramUsername: c.telegramUsername,
    billing: billingOf(c),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** El personal ve lo necesario para atender, no los datos fiscales ni el Telegram. */
function toSummary(c: Customer): CustomerSummaryDTO {
  return { id: c.id, userId: c.userId, fullName: c.fullName, phone: c.phone };
}

const billingColumns = (b: BillingInput | null | undefined) =>
  b === undefined
    ? {}
    : {
        billingRfc: b?.rfc ?? null,
        billingBusinessName: b?.businessName ?? null,
        billingPostalCode: b?.postalCode ?? null,
        billingTaxRegime: b?.taxRegime ?? null,
        billingCfdiUse: b?.cfdiUse ?? null,
      };

async function getByUserOrThrow(userId: string): Promise<Customer> {
  const customer = await customerRepository.findByUserId(userId);
  if (!customer) throw AppError.notFound("Perfil de cliente");
  return customer;
}

/** CAPA 3 — SERVICE: perfil del cliente en línea, datos fiscales y vínculo con Telegram. */
export const customerService = {
  // ---- el propio cliente ----

  async getMine(userId: string): Promise<CustomerDTO> {
    return toDTO(await getByUserOrThrow(userId));
  },

  /** Crea o actualiza el perfil ligado a la cuenta de quien llama. */
  async upsertMine(userId: string, input: CustomerProfileInput): Promise<CustomerDTO> {
    const data = { fullName: input.fullName, phone: input.phone, ...billingColumns(input.billing) };
    const existing = await customerRepository.findByUserId(userId);
    return toDTO(
      existing
        ? await customerRepository.update(existing.id, data)
        : await customerRepository.create({ userId, ...data })
    );
  },

  /** Genera un código temporal para vincular Telegram: el cliente lo manda al bot con /start. */
  async createLinkCode(userId: string): Promise<TelegramLinkCodeDTO> {
    const customer = await getByUserOrThrow(userId);

    let code = generateLinkCode();
    for (let attempt = 0; attempt < 5 && (await customerRepository.findByLinkCode(code)); attempt++) {
      code = generateLinkCode();
    }

    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await customerRepository.update(customer.id, { linkCode: code, linkCodeExpiresAt: expiresAt });
    return { code, expiresAt: expiresAt.toISOString() };
  },

  async unlinkTelegram(userId: string): Promise<CustomerDTO> {
    const customer = await getByUserOrThrow(userId);
    return toDTO(
      await customerRepository.update(customer.id, {
        telegramChatId: null,
        telegramUsername: null,
        linkCode: null,
        linkCodeExpiresAt: null,
      })
    );
  },

  // ---- personal ----

  async list(search?: string): Promise<CustomerSummaryDTO[]> {
    return (await customerRepository.findMany(search)).map(toSummary);
  },

  async get(id: string): Promise<CustomerSummaryDTO> {
    const customer = await customerRepository.findById(id);
    if (!customer) throw AppError.notFound("Cliente");
    return toSummary(customer);
  },

  // ---- uso interno (Order, Notification, Reservation, Payment) ----

  async getByUserInternal(userId: string): Promise<CustomerInternalDTO> {
    const customer = await getByUserOrThrow(userId);
    return { ...toDTO(customer), telegramChatId: customer.telegramChatId };
  },

  async getByChatInternal(chatId: string): Promise<CustomerInternalDTO> {
    const customer = await customerRepository.findByChatId(chatId);
    if (!customer) throw AppError.notFound("Cliente");
    return { ...toDTO(customer), telegramChatId: customer.telegramChatId };
  },

  /** El bot de Telegram canjea el código que recibió en /start. */
  async linkTelegram(input: TelegramLinkInput): Promise<CustomerDTO> {
    const customer = await customerRepository.findByLinkCode(input.code);
    if (!customer || !customer.linkCodeExpiresAt || customer.linkCodeExpiresAt < new Date()) {
      throw AppError.notFound("Código de vinculación válido (es posible que haya vencido)");
    }
    return toDTO(await customerRepository.bindTelegram(customer.id, input.chatId, input.username ?? null));
  },
};
