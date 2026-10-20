import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { errorMessage } from "../ui";

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username, password);
      else await register({ username, email, password });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>🥩 Asador La Brasa</h1>
        <p className="muted">Cortes premium a la parrilla</p>

        <div className="seg" role="tablist">
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            Entrar
          </button>
          <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>
            Soy cliente nuevo
          </button>
        </div>

        <label>
          Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
        </label>

        {mode === "register" && (
          <label>
            Correo
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
        )}

        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </label>

        {mode === "register" && (
          <p className="hint">
            Mínimo 8 caracteres, con mayúscula, minúscula y número. Con tu cuenta podrás pedir en línea, pagar y reservar. Las cuentas del
            personal las crea el administrador.
          </p>
        )}

        {error && <p className="error-box">{error}</p>}

        <button className="primary" disabled={busy}>
          {busy ? "Un momento…" : mode === "login" ? "Entrar" : "Crear mi cuenta"}
        </button>

        <details className="demo">
          <summary>Cuentas de demostración</summary>
          <p className="hint">
            Después de ejecutar <code>npm run seed</code>: <b>admin</b> / Admin1234 · <b>gerente</b>, <b>mesero</b>, <b>cocinero</b>,{" "}
            <b>cajero</b> y el cliente <b>cliente</b> / Demo1234.
          </p>
        </details>
      </form>
    </main>
  );
}
