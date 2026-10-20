import { useState, type FormEvent } from "react";
import { del, get, post, put } from "../api";
import type { BillingInput, CustomerDTO, TelegramInfoDTO, TelegramLinkCodeDTO } from "../types";
import { Badge, PageHead, errorMessage, useLoad, useToast } from "../ui";

const EMPTY_BILLING: BillingInput = { rfc: "", businessName: "", postalCode: "", taxRegime: "", cfdiUse: "G03" };

function TelegramBox({ profile, onChange }: { profile: CustomerDTO; onChange: () => void }) {
  const toast = useToast();
  const info = useLoad(() => get<{ data: TelegramInfoDTO }>("/notifications/telegram").then((r) => r.data));
  const [code, setCode] = useState<TelegramLinkCodeDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const bot = info.data?.botUsername;

  async function generate() {
    setBusy(true);
    try {
      setCode((await post<{ data: TelegramLinkCodeDTO }>("/customers/me/telegram-link")).data);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await del("/customers/me/telegram");
      setCode(null);
      toast("Telegram desvinculado");
      onChange();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card form">
      <h3>Avisos por Telegram</h3>
      <p className="muted small">
        Vincula tu Telegram para recibir ahí cuando tu pedido esté listo, un recordatorio antes de tu reservación y el resumen de tu
        consumo. También podrás reservar escribiéndole al bot.
      </p>

      {info.data && !info.data.configured && (
        <p className="note-box">
          Modo demostración: el bot de Telegram aún no está configurado en el servidor (falta <code>TELEGRAM_BOT_TOKEN</code>). Los avisos
          siguen llegando aquí, en la campana 🔔.
        </p>
      )}

      {profile.telegramLinked ? (
        <div className="row-between">
          <span>
            <Badge tone="ok">Vinculado</Badge> {profile.telegramUsername ? `@${profile.telegramUsername}` : "tu cuenta de Telegram"}
          </span>
          <button className="danger" disabled={busy} onClick={() => void unlink()}>
            Desvincular
          </button>
        </div>
      ) : (
        <>
          <div>
            <button className="primary" disabled={busy} onClick={() => void generate()}>
              Generar código de vinculación
            </button>
          </div>
          {code && (
            <div className="link-code">
              <p>
                Tu código (vale 15 minutos): <b className="code-big">{code.code}</b>
              </p>
              {bot ? (
                <>
                  <p>
                    <a href={`https://t.me/${bot}?start=${code.code}`} target="_blank" rel="noreferrer">
                      Abrir @{bot} en Telegram
                    </a>
                  </p>
                  <p className="hint">
                    O abre el bot y escribe <code>/start {code.code}</code>.
                  </p>
                </>
              ) : (
                <p className="hint">
                  Abre el bot del restaurante en Telegram y escribe <code>/start {code.code}</code>.
                </p>
              )}
              <button className="small-btn" onClick={onChange}>
                Ya lo envié, revisar
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Profile({ profile, reload }: { profile: CustomerDTO | null; reload: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [wantsInvoice, setWantsInvoice] = useState(profile?.billing != null);
  const [billing, setBilling] = useState<BillingInput>(profile?.billing ?? EMPTY_BILLING);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setB = (k: keyof BillingInput, v: string) => setBilling((b) => ({ ...b, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await put("/customers/me", {
        fullName,
        phone,
        // null borra los datos fiscales; si no se quiere factura se mandan explícitamente vacíos.
        billing: wantsInvoice ? billing : null,
      });
      toast("Perfil guardado");
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Mi perfil" hint="Con estos datos te atendemos en pedidos y reservaciones." />

      {!profile && (
        <p className="note-box">
          Para pedir en línea o reservar primero completa tu nombre y teléfono. Es solo una vez.
        </p>
      )}

      <div className="stack">
        <form className="card form" onSubmit={submit}>
          <h3>Datos de contacto</h3>
          <div className="row">
            <label>
              Nombre completo
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={3} maxLength={120} />
            </label>
            <label>
              Teléfono (10 dígitos)
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" pattern="\d{10}" required />
            </label>
          </div>

          <label className="check">
            <input type="checkbox" checked={wantsInvoice} onChange={(e) => setWantsInvoice(e.target.checked)} />
            Quiero guardar mis datos fiscales para facturar
          </label>

          {wantsInvoice && (
            <>
              <div className="row">
                <label>
                  RFC
                  <input value={billing.rfc} onChange={(e) => setB("rfc", e.target.value.toUpperCase())} maxLength={13} required />
                </label>
                <label>
                  Nombre o razón social
                  <input value={billing.businessName} onChange={(e) => setB("businessName", e.target.value)} required />
                </label>
              </div>
              <div className="row">
                <label>
                  Código postal fiscal
                  <input value={billing.postalCode} onChange={(e) => setB("postalCode", e.target.value)} inputMode="numeric" maxLength={5} required />
                </label>
                <label>
                  Régimen fiscal (clave)
                  <input value={billing.taxRegime} onChange={(e) => setB("taxRegime", e.target.value)} placeholder="612" maxLength={3} required />
                </label>
              </div>
              <label>
                Uso de CFDI
                <input value={billing.cfdiUse} onChange={(e) => setB("cfdiUse", e.target.value.toUpperCase())} placeholder="G03" maxLength={3} required />
              </label>
              <p className="hint">Al terminar tu consumo te preguntaremos si vas a facturar; con esto ya tendremos lo necesario.</p>
            </>
          )}

          {error && <p className="error-box">{error}</p>}
          <div>
            <button className="primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>

        {profile && <TelegramBox profile={profile} onChange={reload} />}
      </div>
    </>
  );
}
