import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.PROFACT_TOKEN = "token-de-prueba";
process.env.PROFACT_URL = "https://pac.example/api/v2/";

const { profactClient, PacRejected } = await import("../clients/profact.client.js");

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const stampedBody = {
  Codigo: 0,
  Mensaje: "",
  Xml: "<cfdi:Comprobante/>",
  CodigoQr: "/9j/4AAQ",
  CadenaOriginalTimbre: "||1.1|uuid|",
  Valores: { UUID: "109cdce9-113d-45f6-ae83-3c2900dac6b2", adenda: "" },
};

afterEach(() => vi.unstubAllGlobals());

describe("timbrar", () => {
  it("manda el XML en base64 con el token de integrador y devuelve UUID, XML, QR y cadena original", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, stampedBody));
    vi.stubGlobal("fetch", fetchMock);

    const result = await profactClient.timbrar("<cfdi:Comprobante>ñ</cfdi:Comprobante>", "inv-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://pac.example/api/v2/Timbrado/TimbraCFDI");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer token-de-prueba");
    const body = JSON.parse(init.body);
    expect(Buffer.from(body.XmlComprobanteBase64, "base64").toString("utf8")).toBe("<cfdi:Comprobante>ñ</cfdi:Comprobante>");
    expect(body.IdComprobante).toBe("inv-1");
    expect(result).toEqual({ uuid: "109cdce9-113d-45f6-ae83-3c2900dac6b2", xml: "<cfdi:Comprobante/>", qrBase64: "/9j/4AAQ", cadenaOriginal: "||1.1|uuid|" });
  });

  it("un rechazo del SAT/PAC (500 con Mensaje) llega como PacRejected con el mensaje del SAT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        reply(500, { Categoria: "FaultsTimbrado", Codigo: 21001, CodigoSat: "21001", Mensaje: "interno", MensajeSat: "CFDI40139 - El Nombre del emisor no corresponde al RFC", Valores: null })
      )
    );
    const err = await profactClient.timbrar("<x/>", "i").catch((e) => e);
    expect(err).toBeInstanceOf(PacRejected);
    expect(err.message).toBe("CFDI40139 - El Nombre del emisor no corresponde al RFC");
    expect(err.code).toBe(21001);
    expect(err.satCode).toBe("21001");
  });

  it("token inválido (401) es un problema nuestro: 503, no un 'rechazo' que se le achaque al cliente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(401, { Codigo: 21, Mensaje: "Token de integrador o contraseña incorrectos." })));
    await expect(profactClient.timbrar("<x/>", "i")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("si Profact no responde -> 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(profactClient.timbrar("<x/>", "i")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("una respuesta 200 con otra forma (cambió su API) -> 503, no se guarda basura", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { Codigo: 0, Xml: "" })));
    await expect(profactClient.timbrar("<x/>", "i")).rejects.toMatchObject({ statusCode: 503 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { ...stampedBody, Codigo: 5 })));
    await expect(profactClient.timbrar("<x/>", "i")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("un 500 sin mensaje legible tampoco se le muestra como rechazo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, null)));
    await expect(profactClient.timbrar("<x/>", "i")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("cancelar", () => {
  it("manda RFC, UUID, motivo y sustituta con los nombres de campo de Profact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { CodigoSat: "0", MensajeSat: "El comprobante será cancelado", XmlAcuse: "<acuse/>", Valores: { UUID: "u" } }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await profactClient.cancelar({ rfcEmisor: "EKU9003173C9", uuid: "uuid-1", reason: "01", replacementUuid: "uuid-2" });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://pac.example/api/v2/Timbrado/CancelaCFDI");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      RfcEmisor: "EKU9003173C9",
      FolioFiscal: "uuid-1",
      MotivoCancelacion: "01",
      FolioFiscalSustitucion: "uuid-2",
    });
    expect(r).toEqual({ message: "El comprobante será cancelado", acuseXml: "<acuse/>" });
  });

  it("sin sustituta manda la cadena vacía", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { MensajeSat: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await profactClient.cancelar({ rfcEmisor: "R", uuid: "u", reason: "02" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).FolioFiscalSustitucion).toBe("");
  });

  it("un rechazo del SAT al cancelar llega como PacRejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, { Codigo: 330314, CodigoSat: "330314", Mensaje: "El folio fiscal de sustitución es requerido" })));
    await expect(profactClient.cancelar({ rfcEmisor: "R", uuid: "u", reason: "01" })).rejects.toBeInstanceOf(PacRejected);
  });
});

describe("configuración", () => {
  it("está configurado cuando hay token", () => {
    expect(profactClient.configured).toBe(true);
  });
});
