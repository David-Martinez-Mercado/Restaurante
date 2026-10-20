import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/order.repository.js", () => ({
  orderRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    findActiveByTable: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("../clients/menu.client.js", () => ({
  menuClient: {
    getDish: vi.fn(),
    getTable: vi.fn(),
    setTableStatus: vi.fn(),
    setTableStatusInternal: vi.fn(),
  },
}));
vi.mock("../clients/customer.client.js", () => ({
  customerClient: { getByUser: vi.fn() },
}));
// Los eventos hacia Notificaciones se espían; el resto de @resto/http es el real.
vi.mock("@resto/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@resto/http")>()),
  emitEvent: vi.fn(),
}));

const { emitEvent } = await import("@resto/http");
const { orderRepository } = await import("../repositories/order.repository.js");
const { menuClient } = await import("../clients/menu.client.js");
const { customerClient } = await import("../clients/customer.client.js");
const { orderService } = await import("../services/order.service.js");

const TABLE_ID = "11111111-1111-4111-8111-111111111111";
const DISH_A = "22222222-2222-4222-8222-222222222222";
const DISH_B = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_USER = "44444444-4444-4444-8444-444444444444";

const waiter = {
  userId: "w1",
  role: "waiter" as const,
  token: "t",
  requestId: "r1",
};
const cashier = { ...waiter, userId: "c1", role: "cashier" as const };
const cook = { ...waiter, userId: "k1", role: "cook" as const };
const customer = { userId: CUSTOMER_USER, role: "customer" as const, token: "tc", requestId: "r9" };
const otherCustomer = { ...customer, userId: "55555555-5555-4555-8555-555555555555" };

const dish = (id: string, name: string, priceCents: number, available = true) => ({
  id,
  name,
  priceCents,
  available,
  description: null,
  category: "main" as const,
  createdAt: "",
  updatedAt: "",
});

const profile = {
  id: "cu1", userId: CUSTOMER_USER, fullName: "Ana López", phone: "5512345678",
  telegramLinked: false, telegramUsername: null, billing: null, createdAt: "", updatedAt: "", telegramChatId: null,
};

const baseOrder = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: "abcdef12-0000-4000-8000-000000000001",
  tableId: TABLE_ID,
  waiterId: "w1",
  channel: "dine_in",
  customerUserId: null,
  customerName: null,
  status,
  notes: null,
  subtotalCents: 20000,
  taxCents: 3200,
  totalCents: 23200,
  paymentMethod: null,
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [{ id: "i1", dishId: DISH_A, dishName: "Rib eye", unitPriceCents: 20000, quantity: 1 }],
  ...overrides,
});
const storedOrder = (status: string, overrides: Record<string, unknown> = {}) => baseOrder(status, overrides) as never;
const OID = "abcdef12-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(menuClient.getTable).mockResolvedValue({
    id: TABLE_ID,
    number: 4,
    capacity: 4,
    status: "free",
    createdAt: "",
    updatedAt: "",
  });
  vi.mocked(orderRepository.findActiveByTable).mockResolvedValue(null);
  vi.mocked(orderRepository.create).mockImplementation(
    async (data) => ({ ...baseOrder("pending"), ...data, items: [] }) as never
  );
});

describe("orderService.create (pedido en mesa)", () => {
  it("calcula totales con IVA usando los precios del menú, no los del cliente", async () => {
    vi.mocked(menuClient.getDish).mockImplementation(async (id) =>
      id === DISH_A ? dish(DISH_A, "Tacos", 8500) : dish(DISH_B, "Agua", 3000)
    );

    await orderService.create(
      {
        tableId: TABLE_ID,
        items: [
          { dishId: DISH_A, quantity: 2 },
          { dishId: DISH_B, quantity: 1 },
        ],
      },
      waiter
    );

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        waiterId: "w1",
        channel: "dine_in",
        subtotalCents: 20000,
        taxCents: 3200,
        totalCents: 23200,
      })
    );
    expect(menuClient.setTableStatus).toHaveBeenCalledWith(TABLE_ID, "occupied", waiter);
  });

  it("une el mismo platillo repetido en un solo renglón", async () => {
    vi.mocked(menuClient.getDish).mockResolvedValue(dish(DISH_A, "Tacos", 1000));

    await orderService.create(
      {
        tableId: TABLE_ID,
        items: [
          { dishId: DISH_A, quantity: 1 },
          { dishId: DISH_A, quantity: 2 },
        ],
      },
      waiter
    );

    expect(menuClient.getDish).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(orderRepository.create).mock.calls[0]![0];
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0]!.quantity).toBe(3);
  });

  it("rechaza un platillo agotado con 409", async () => {
    vi.mocked(menuClient.getDish).mockResolvedValue(dish(DISH_A, "Tacos", 1000, false));

    await expect(
      orderService.create({ tableId: TABLE_ID, items: [{ dishId: DISH_A, quantity: 1 }] }, waiter)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(orderRepository.create).not.toHaveBeenCalled();
  });

  it("rechaza un platillo inexistente con 404", async () => {
    vi.mocked(menuClient.getDish).mockResolvedValue(null);

    await expect(
      orderService.create({ tableId: TABLE_ID, items: [{ dishId: DISH_A, quantity: 1 }] }, waiter)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rechaza una mesa inexistente con 404", async () => {
    vi.mocked(menuClient.getTable).mockResolvedValue(null);

    await expect(
      orderService.create({ tableId: TABLE_ID, items: [{ dishId: DISH_A, quantity: 1 }] }, waiter)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rechaza una mesa que ya tiene un pedido activo con 409", async () => {
    vi.mocked(orderRepository.findActiveByTable).mockResolvedValue(storedOrder("preparing"));

    await expect(
      orderService.create({ tableId: TABLE_ID, items: [{ dishId: DISH_A, quantity: 1 }] }, waiter)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("puede ligarse a un cliente registrado (guarda su nombre) y 404 si no existe", async () => {
    vi.mocked(menuClient.getDish).mockResolvedValue(dish(DISH_A, "Tacos", 1000));
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile);

    await orderService.create(
      { tableId: TABLE_ID, customerUserId: CUSTOMER_USER, items: [{ dishId: DISH_A, quantity: 1 }] },
      waiter
    );
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerUserId: CUSTOMER_USER, customerName: "Ana López" })
    );

    vi.mocked(customerClient.getByUser).mockResolvedValue(null);
    await expect(
      orderService.create(
        { tableId: TABLE_ID, customerUserId: CUSTOMER_USER, items: [{ dishId: DISH_A, quantity: 1 }] },
        waiter
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("orderService.createOnline (cliente en línea)", () => {
  it("crea un pedido para recoger: sin mesa, sin mesero, ligado al cliente", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile);
    vi.mocked(menuClient.getDish).mockResolvedValue(dish(DISH_A, "Rib eye", 42900));

    const result = await orderService.createOnline({ items: [{ dishId: DISH_A, quantity: 2 }] }, customer);

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: null,
        waiterId: null,
        channel: "pickup",
        customerUserId: CUSTOMER_USER,
        customerName: "Ana López",
        subtotalCents: 85800,
        taxCents: 13728,
        totalCents: 99528,
      })
    );
    expect(menuClient.setTableStatus).not.toHaveBeenCalled();
    expect(result.channel).toBe("pickup");
  });

  it("exige tener el perfil de cliente completo (409)", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(null);
    await expect(
      orderService.createOnline({ items: [{ dishId: DISH_A, quantity: 1 }] }, customer)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(orderRepository.create).not.toHaveBeenCalled();
  });

  it("rechaza platillos agotados (409)", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile);
    vi.mocked(menuClient.getDish).mockResolvedValue(dish(DISH_A, "Rib eye", 42900, false));
    await expect(
      orderService.createOnline({ items: [{ dishId: DISH_A, quantity: 1 }] }, customer)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("pedidos propios del cliente", () => {
  it("un cliente no ve el pedido de otro (404, no 403)", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("pending", { customerUserId: CUSTOMER_USER }));

    await expect(orderService.getMine(OID, otherCustomer)).rejects.toMatchObject({ statusCode: 404 });
    await expect(orderService.getMine(OID, customer)).resolves.toMatchObject({ code: "ABCDEF" });
  });

  it("la lista se filtra por la cuenta del cliente", async () => {
    vi.mocked(orderRepository.findMany).mockResolvedValue([]);
    await orderService.listMine(customer);
    expect(orderRepository.findMany).toHaveBeenCalledWith({ customerUserId: CUSTOMER_USER });
  });
});

describe("orderService.changeStatus", () => {
  it("el cocinero pasa un pedido de pending a preparing", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("pending"));
    vi.mocked(orderRepository.update).mockResolvedValue(storedOrder("preparing"));

    const result = await orderService.changeStatus(OID, "preparing", cook);

    expect(result.status).toBe("preparing");
    expect(menuClient.setTableStatus).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("el cocinero NO puede cobrar (403) aunque la transición sea válida", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("served"));

    await expect(orderService.changeStatus(OID, "paid", cook, "cash")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(orderRepository.update).not.toHaveBeenCalled();
  });

  it("rechaza una transición inválida con 409", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("pending"));

    await expect(orderService.changeStatus(OID, "paid", cashier, "cash")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("al cobrar, el cajero DEBE indicar el método de pago (422)", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("served"));

    await expect(orderService.changeStatus(OID, "paid", cashier)).rejects.toMatchObject({ statusCode: 422 });
    expect(orderRepository.update).not.toHaveBeenCalled();
  });

  it("al cobrar con método, guarda método y fecha de pago y libera la mesa", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("served"));
    vi.mocked(orderRepository.update).mockResolvedValue(storedOrder("paid", { paymentMethod: "card", paidAt: new Date() }));

    await orderService.changeStatus(OID, "paid", cashier, "card");

    expect(orderRepository.update).toHaveBeenCalledWith(
      OID,
      expect.objectContaining({ status: "paid", paymentMethod: "card", paidAt: expect.any(Date) })
    );
    expect(menuClient.setTableStatus).toHaveBeenCalledWith(TABLE_ID, "free", cashier);
  });

  it("al cancelar, el mesero libera la mesa", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("pending"));
    vi.mocked(orderRepository.update).mockResolvedValue(storedOrder("cancelled"));

    await orderService.changeStatus(OID, "cancelled", waiter);

    expect(menuClient.setTableStatus).toHaveBeenCalledWith(TABLE_ID, "free", waiter);
  });

  it("404 si el pedido no existe", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(null);

    await expect(orderService.changeStatus("nope", "preparing", cook)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("no se cancela un pedido ya pagado en línea (409): requiere reembolso", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(
      storedOrder("pending", { paidAt: new Date(), paymentMethod: "online" })
    );
    await expect(orderService.changeStatus(OID, "cancelled", waiter)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("avisos al cliente (eventos hacia Notificaciones)", () => {
  it("cuando el pedido de un cliente queda LISTO se emite order.ready", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("preparing", { customerUserId: CUSTOMER_USER }));
    vi.mocked(orderRepository.update).mockResolvedValue(storedOrder("ready", { customerUserId: CUSTOMER_USER }));

    await orderService.changeStatus(OID, "ready", cook);

    expect(emitEvent).toHaveBeenCalledWith("order.ready", {
      orderId: OID,
      orderCode: "ABCDEF",
      customerUserId: CUSTOMER_USER,
    });
  });

  it("si el pedido no tiene cliente (mesa sin registro) no se avisa a nadie", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("preparing"));
    vi.mocked(orderRepository.update).mockResolvedValue(storedOrder("ready"));

    await orderService.changeStatus(OID, "ready", cook);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("al pagar se emite order.paid con consumo, descripción y método de pago", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("served", { customerUserId: CUSTOMER_USER }));
    vi.mocked(orderRepository.update).mockResolvedValue(
      storedOrder("paid", { customerUserId: CUSTOMER_USER, paymentMethod: "cash", paidAt: new Date() })
    );

    await orderService.changeStatus(OID, "paid", cashier, "cash");

    expect(emitEvent).toHaveBeenCalledWith(
      "order.paid",
      expect.objectContaining({
        orderCode: "ABCDEF",
        customerUserId: CUSTOMER_USER,
        paymentMethod: "cash",
        totalCents: 23200,
        channel: "dine_in",
        items: [{ name: "Rib eye", quantity: 1, lineTotalCents: 20000 }],
      })
    );
  });
});

describe("orderService.confirmPayment (pago en línea confirmado por la pasarela)", () => {
  const input = { paymentId: "66666666-6666-4666-8666-666666666666" };

  it("un pedido pendiente queda marcado como pagado en línea, sin cambiar de estado", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("pending", { customerUserId: CUSTOMER_USER }));
    vi.mocked(orderRepository.update).mockResolvedValue(
      storedOrder("pending", { customerUserId: CUSTOMER_USER, paymentMethod: "online", paidAt: new Date() })
    );

    await orderService.confirmPayment(OID, input);

    expect(orderRepository.update).toHaveBeenCalledWith(
      OID,
      expect.objectContaining({ paymentMethod: "online", paidAt: expect.any(Date) })
    );
    expect(vi.mocked(orderRepository.update).mock.calls[0]![1]).not.toHaveProperty("status");
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("si ya se había servido, pasa a pagado, libera la mesa y emite order.paid", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("served", { customerUserId: CUSTOMER_USER }));
    vi.mocked(orderRepository.update).mockResolvedValue(
      storedOrder("paid", { customerUserId: CUSTOMER_USER, paymentMethod: "online", paidAt: new Date() })
    );

    await orderService.confirmPayment(OID, input);

    expect(orderRepository.update).toHaveBeenCalledWith(OID, expect.objectContaining({ status: "paid" }));
    expect(menuClient.setTableStatusInternal).toHaveBeenCalledWith(TABLE_ID, "free", expect.any(String));
    expect(emitEvent).toHaveBeenCalledWith("order.paid", expect.objectContaining({ paymentMethod: "online" }));
  });

  it("es idempotente: un pedido ya pagado no se modifica", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(
      storedOrder("pending", { paidAt: new Date(), paymentMethod: "online" })
    );
    await orderService.confirmPayment(OID, input);
    expect(orderRepository.update).not.toHaveBeenCalled();
  });

  it("un pedido cancelado no admite confirmación (409)", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(storedOrder("cancelled"));
    await expect(orderService.confirmPayment(OID, input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("al servir un pedido ya pagado en línea pasa directo a pagado (sin cobrar de nuevo)", async () => {
    vi.mocked(orderRepository.findById).mockResolvedValue(
      storedOrder("ready", { channel: "pickup", tableId: null, customerUserId: CUSTOMER_USER, paymentMethod: "online", paidAt: new Date() })
    );
    vi.mocked(orderRepository.update).mockResolvedValue(
      storedOrder("paid", { channel: "pickup", tableId: null, customerUserId: CUSTOMER_USER, paymentMethod: "online", paidAt: new Date() })
    );

    const result = await orderService.changeStatus(OID, "served", waiter);

    expect(orderRepository.update).toHaveBeenCalledWith(OID, { status: "paid" });
    expect(result.status).toBe("paid");
    expect(menuClient.setTableStatus).not.toHaveBeenCalled(); // sin mesa
    expect(emitEvent).toHaveBeenCalledWith("order.paid", expect.objectContaining({ channel: "pickup", paymentMethod: "online" }));
  });
});
