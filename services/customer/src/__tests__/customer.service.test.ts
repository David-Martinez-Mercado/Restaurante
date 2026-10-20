import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/customer.repository.js", () => ({
  customerRepository: {
    findById: vi.fn(),
    findByUserId: vi.fn(),
    findByChatId: vi.fn(),
    findByLinkCode: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    bindTelegram: vi.fn(),
  },
}));

const { customerRepository } = await import("../repositories/customer.repository.js");
const { customerService, generateLinkCode } = await import("../services/customer.service.js");

const now = new Date();
const row = (o: Record<string, unknown> = {}) =>
  ({
    id: "c1", userId: "u1", fullName: "Ana López", phone: "5512345678",
    telegramChatId: null, telegramUsername: null, linkCode: null, linkCodeExpiresAt: null,
    billingRfc: null, billingBusinessName: null, billingPostalCode: null, billingTaxRegime: null, billingCfdiUse: null,
    createdAt: now, updatedAt: now, ...o,
  }) as never;

const billing = { rfc: "LOPA900101AB1", businessName: "Ana López", postalCode: "06600", taxRegime: "612", cfdiUse: "G03" };

beforeEach(() => vi.clearAllMocks());

describe("perfil propio", () => {
  const input = { fullName: "Ana López", phone: "5512345678" };

  it("crea el perfil la primera vez, ligado a la cuenta", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(customerRepository.create).mockResolvedValue(row());

    await customerService.upsertMine("u1", input);

    expect(customerRepository.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", fullName: "Ana López" }));
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it("actualiza (sin duplicar) si ya existe", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(row());
    vi.mocked(customerRepository.update).mockResolvedValue(row({ phone: "5599999999" }));

    await customerService.upsertMine("u1", { ...input, phone: "5599999999" });

    expect(customerRepository.update).toHaveBeenCalledWith("c1", expect.objectContaining({ phone: "5599999999" }));
    expect(customerRepository.create).not.toHaveBeenCalled();
  });

  it("guarda los datos fiscales; null los borra; omitirlos los conserva", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(row());
    vi.mocked(customerRepository.update).mockResolvedValue(row({ billingRfc: billing.rfc }));

    await customerService.upsertMine("u1", { ...input, billing });
    expect(customerRepository.update).toHaveBeenLastCalledWith("c1", expect.objectContaining({ billingRfc: "LOPA900101AB1", billingCfdiUse: "G03" }));

    await customerService.upsertMine("u1", { ...input, billing: null });
    expect(customerRepository.update).toHaveBeenLastCalledWith("c1", expect.objectContaining({ billingRfc: null, billingBusinessName: null }));

    await customerService.upsertMine("u1", input);
    expect(vi.mocked(customerRepository.update).mock.lastCall![1]).not.toHaveProperty("billingRfc");
  });

  it("devuelve los datos fiscales completos al propio cliente", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(
      row({ billingRfc: billing.rfc, billingBusinessName: "Ana López", billingPostalCode: "06600", billingTaxRegime: "612", billingCfdiUse: "G03" })
    );
    expect((await customerService.getMine("u1")).billing).toEqual(billing);
  });

  it("404 si aún no tiene perfil", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(null);
    await expect(customerService.getMine("u1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("vista del personal", () => {
  it("la lista y el detalle NO exponen datos fiscales ni Telegram", async () => {
    const full = row({ billingRfc: billing.rfc, telegramChatId: "999" });
    vi.mocked(customerRepository.findMany).mockResolvedValue([full]);
    vi.mocked(customerRepository.findById).mockResolvedValue(full);

    const [item] = await customerService.list("ana");
    expect(item).toEqual({ id: "c1", userId: "u1", fullName: "Ana López", phone: "5512345678" });
    expect(await customerService.get("c1")).not.toHaveProperty("billing");
  });
});

describe("vinculación con Telegram", () => {
  it("el código tiene 6 caracteres sin letras ambiguas", () => {
    for (let i = 0; i < 200; i++) expect(generateLinkCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("genera un código que vence en 15 minutos", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(row());
    vi.mocked(customerRepository.findByLinkCode).mockResolvedValue(null);

    const result = await customerService.createLinkCode("u1");

    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const minutes = (Date.parse(result.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    expect(customerRepository.update).toHaveBeenCalledWith("c1", expect.objectContaining({ linkCode: result.code }));
  });

  it("no genera código sin perfil (404)", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(null);
    await expect(customerService.createLinkCode("u1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("el bot canjea un código vigente y queda vinculado", async () => {
    vi.mocked(customerRepository.findByLinkCode).mockResolvedValue(
      row({ linkCode: "ABC234", linkCodeExpiresAt: new Date(Date.now() + 60_000) })
    );
    vi.mocked(customerRepository.bindTelegram).mockResolvedValue(row({ telegramChatId: "777", telegramUsername: "ana" }));

    const result = await customerService.linkTelegram({ code: "ABC234", chatId: "777", username: "ana" });

    expect(customerRepository.bindTelegram).toHaveBeenCalledWith("c1", "777", "ana");
    expect(result.telegramLinked).toBe(true);
  });

  it("rechaza un código inexistente o vencido (404)", async () => {
    vi.mocked(customerRepository.findByLinkCode).mockResolvedValue(null);
    await expect(customerService.linkTelegram({ code: "ZZZ999", chatId: "1" })).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(customerRepository.findByLinkCode).mockResolvedValue(
      row({ linkCode: "ABC234", linkCodeExpiresAt: new Date(Date.now() - 1000) })
    );
    await expect(customerService.linkTelegram({ code: "ABC234", chatId: "1" })).rejects.toMatchObject({ statusCode: 404 });
    expect(customerRepository.bindTelegram).not.toHaveBeenCalled();
  });

  it("desvincular borra el chat y cualquier código pendiente", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(row({ telegramChatId: "777" }));
    vi.mocked(customerRepository.update).mockResolvedValue(row());

    await customerService.unlinkTelegram("u1");

    expect(customerRepository.update).toHaveBeenCalledWith("c1", {
      telegramChatId: null, telegramUsername: null, linkCode: null, linkCodeExpiresAt: null,
    });
  });
});

describe("consultas internas", () => {
  it("incluyen el chat de Telegram para poder avisar al cliente", async () => {
    vi.mocked(customerRepository.findByUserId).mockResolvedValue(row({ telegramChatId: "777" }));
    vi.mocked(customerRepository.findByChatId).mockResolvedValue(row({ telegramChatId: "777" }));

    expect((await customerService.getByUserInternal("u1")).telegramChatId).toBe("777");
    expect((await customerService.getByChatInternal("777")).userId).toBe("u1");
  });

  it("404 si el chat no está vinculado a ningún cliente", async () => {
    vi.mocked(customerRepository.findByChatId).mockResolvedValue(null);
    await expect(customerService.getByChatInternal("000")).rejects.toMatchObject({ statusCode: 404 });
  });
});
