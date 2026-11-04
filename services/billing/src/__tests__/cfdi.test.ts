import { describe, expect, it } from "vitest";
import {
  allocateTax,
  amount,
  buildCfdi,
  computeAmounts,
  escapeXml,
  formatFecha,
  normalizeName,
  parseTimbre,
  paymentFormOf,
  sameMonthInZone,
} from "../domain/cfdi.js";

describe("amount · centavos a texto con 2 decimales", () => {
  it("sin errores de punto flotante", () => {
    expect(amount(0)).toBe("0.00");
    expect(amount(5)).toBe("0.05");
    expect(amount(100)).toBe("1.00");
    expect(amount(12345)).toBe("123.45");
    expect(amount(1_000_000_00)).toBe("1000000.00");
  });
});

describe("allocateTax · el IVA de los conceptos suma EXACTAMENTE el IVA del pedido", () => {
  const orderTax = (bases: number[]) => Math.round((bases.reduce((s, b) => s + b, 0) * 16) / 100);

  it("un solo concepto recibe todo", () => {
    expect(allocateTax([10000], 1600)).toEqual([1600]);
  });

  it("reparte el centavo sobrante al concepto con mayor residuo", () => {
    // 3 conceptos de 0.05 de IVA exacto cada uno... bases 333 -> 53.28, 333 -> 53.28, 334 -> 53.44
    const bases = [333, 333, 334];
    const tax = allocateTax(bases, orderTax(bases));
    expect(tax.reduce((s, t) => s + t, 0)).toBe(orderTax(bases));
    // cada concepto queda en el piso o el piso + 1 de su IVA exacto
    bases.forEach((b, i) => {
      const exact = (b * 16) / 100;
      expect(tax[i]).toBeGreaterThanOrEqual(Math.floor(exact));
      expect(tax[i]).toBeLessThanOrEqual(Math.ceil(exact));
    });
  });

  it("para muchos pedidos distintos la suma siempre cuadra y cada concepto queda a ≤ 1 centavo del exacto", () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 500; n++) {
      const bases = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => 100 + Math.floor(rand() * 90000));
      const total = orderTax(bases);
      const tax = allocateTax(bases, total);
      expect(tax.reduce((s, t) => s + t, 0)).toBe(total);
      bases.forEach((b, i) => expect(Math.abs(tax[i]! - (b * 16) / 100)).toBeLessThan(1));
    }
  });

  it("si el IVA del pedido no corresponde a los conceptos, falla en lugar de timbrar algo inconsistente", () => {
    expect(() => allocateTax([10000, 10000], 9999)).toThrow(/no cuadra/);
    expect(() => allocateTax([10000], 1)).toThrow(/no cuadra/);
  });
});

describe("computeAmounts", () => {
  it("importes por concepto y totales del pedido", () => {
    const r = computeAmounts(
      [
        { description: "Rib eye", quantity: 2, unitPriceCents: 42900 },
        { description: "Cerveza", quantity: 1, unitPriceCents: 6000 },
      ],
      14688
    );
    expect(r.subtotalCents).toBe(91800);
    expect(r.totalCents).toBe(91800 + 14688);
    expect(r.concepts.map((c) => c.amountCents)).toEqual([85800, 6000]);
    expect(r.concepts.reduce((s, c) => s + c.taxCents, 0)).toBe(14688);
  });
});

describe("paymentFormOf · clave SAT de la forma de pago", () => {
  it("efectivo = 01; tarjeta y pago en línea = 04", () => {
    expect(paymentFormOf("cash")).toBe("01");
    expect(paymentFormOf("card")).toBe("04");
    expect(paymentFormOf("online")).toBe("04");
  });
  it("sin método de pago no se factura", () => {
    expect(() => paymentFormOf(null)).toThrow(/método de pago/);
  });
});

describe("fechas", () => {
  it("la fecha del CFDI va en hora LOCAL del lugar de expedición (no UTC)", () => {
    expect(formatFecha(new Date("2030-06-04T02:00:00Z"), "America/Mexico_City")).toBe("2030-06-03T20:00:00");
    expect(formatFecha(new Date("2030-06-04T02:00:00Z"), "UTC")).toBe("2030-06-04T02:00:00");
  });

  it("solo se factura dentro del mes del consumo, según la zona del restaurante", () => {
    const z = "America/Mexico_City";
    expect(sameMonthInZone(new Date("2030-05-20T18:00:00Z"), new Date("2030-05-31T20:00:00Z"), z)).toBe(true);
    expect(sameMonthInZone(new Date("2030-05-20T18:00:00Z"), new Date("2030-06-02T18:00:00Z"), z)).toBe(false);
    // 1 jun 03:00 UTC todavía es 31 may 21:00 en México
    expect(sameMonthInZone(new Date("2030-05-20T18:00:00Z"), new Date("2030-06-01T03:00:00Z"), z)).toBe(true);
  });
});

describe("textos", () => {
  it("escapa lo que rompería el XML", () => {
    expect(escapeXml(`Tacos "al pastor" & <piña> 'x'`)).toBe("Tacos &quot;al pastor&quot; &amp; &lt;piña&gt; &apos;x&apos;");
  });
  it("normaliza nombres: mayúsculas y espacios simples", () => {
    expect(normalizeName("  xenon   industrial articles ")).toBe("XENON INDUSTRIAL ARTICLES");
  });
});

describe("buildCfdi · XML CFDI 4.0 sin sellar", () => {
  const input = {
    serie: "A",
    folio: 12,
    now: new Date("2030-06-04T02:00:00Z"),
    timeZone: "America/Mexico_City",
    paymentForm: "01",
    emisor: { rfc: "EKU9003173C9", name: "Escuela Kemper Urgate", taxRegime: "601", postalCode: "42501" },
    receptor: { rfc: "XIA190128J61", name: "xenon industrial articles", postalCode: "76343", taxRegime: "601", cfdiUse: "G03" },
    lines: [
      { description: 'Rib eye "400 g" & guarnición', quantity: 2, unitPriceCents: 42900 },
      { description: "Cerveza", quantity: 1, unitPriceCents: 6000 },
    ],
    taxCents: 14688, // 16 % de 918.00
  };
  const built = buildCfdi(input);

  it("trae los datos del comprobante, emisor y receptor", () => {
    expect(built.xml).toContain('Version="4.0"');
    expect(built.xml).toContain('Serie="A" Folio="12"');
    expect(built.xml).toContain('Fecha="2030-06-03T20:00:00"');
    expect(built.xml).toContain('FormaPago="01" MetodoPago="PUE"');
    expect(built.xml).toContain('TipoDeComprobante="I" Exportacion="01" LugarExpedicion="42501"');
    expect(built.xml).toContain('<cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>');
    expect(built.xml).toContain('Rfc="XIA190128J61" Nombre="XENON INDUSTRIAL ARTICLES" DomicilioFiscalReceptor="76343" RegimenFiscalReceptor="601" UsoCFDI="G03"');
  });

  it("NO lleva sello, certificado ni número de certificado: el PAC autosella", () => {
    expect(built.xml).not.toMatch(/\bSello=/);
    expect(built.xml).not.toMatch(/\bCertificado=/);
    expect(built.xml).not.toMatch(/\bNoCertificado=/);
  });

  it("un concepto por renglón del pedido, con IVA trasladado y ObjetoImp 02", () => {
    expect(built.xml.match(/<cfdi:Concepto /g)).toHaveLength(2);
    expect(built.xml).toContain('ClaveProdServ="90101501"');
    expect(built.xml).toContain('ObjetoImp="02"');
    expect(built.xml).toContain('Cantidad="2"');
    expect(built.xml).toContain('ValorUnitario="429.00" Importe="858.00"');
    expect(built.xml).toContain('TasaOCuota="0.160000"');
  });

  it("escapa la descripción del platillo", () => {
    expect(built.xml).toContain('Descripcion="Rib eye &quot;400 g&quot; &amp; guarnición"');
  });

  it("los totales cuadran: Total = SubTotal + IVA, e IVA de conceptos = IVA global", () => {
    expect(built).toMatchObject({ subtotalCents: 91800, ivaCents: 14688, totalCents: 106488 });
    expect(built.xml).toContain('SubTotal="918.00" Moneda="MXN" Total="1064.88"');
    expect(built.xml).toContain('TotalImpuestosTrasladados="146.88"');
    const conceptTaxes = [...built.xml.matchAll(/<cfdi:Concepto [\s\S]*?<cfdi:Traslado [^>]*Importe="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.round(conceptTaxes.reduce((s, t) => s + t, 0) * 100)).toBe(14688);
  });
});

describe("parseTimbre", () => {
  const xml =
    '<cfdi:Comprobante Total="1.00"><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="109cdce9-113d-45f6-ae83-3c2900dac6b2" FechaTimbrado="2026-11-03T07:59:05" RfcProvCertif="SPR190613I52" SelloCFD="AAAA" NoCertificadoSAT="30001000000500003456" SelloSAT="BBBB"/></cfdi:Complemento></cfdi:Comprobante>';

  it("extrae UUID, fecha, sellos y certificado del SAT", () => {
    expect(parseTimbre(xml)).toEqual({
      uuid: "109cdce9-113d-45f6-ae83-3c2900dac6b2",
      fechaTimbrado: "2026-11-03T07:59:05",
      selloCfd: "AAAA",
      selloSat: "BBBB",
      noCertificadoSat: "30001000000500003456",
    });
  });

  it("sin timbre devuelve nulos (no confunde atributos del comprobante)", () => {
    expect(parseTimbre('<cfdi:Comprobante UUID="x" SelloSAT="y"/>')).toEqual({
      uuid: null,
      fechaTimbrado: null,
      selloCfd: null,
      selloSat: null,
      noCertificadoSat: null,
    });
  });
});
