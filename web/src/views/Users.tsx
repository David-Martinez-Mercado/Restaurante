import { useState, type FormEvent } from "react";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { ROLE_LABEL, STAFF_ROLES, type Role, type UserPublicDTO } from "../types";
import { Badge, Modal, PageHead, State, dateTime, errorMessage, useLoad, useToast } from "../ui";

function NewUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("waiter");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/auth/users", { username, email, password, role });
      toast(`Usuario ${username} creado`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo usuario del personal" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Contraseña inicial
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </label>
        <p className="hint">Mínimo 8 caracteres, con mayúscula, minúscula y número.</p>
        <label>
          Rol
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error-box">{error}</p>}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            Crear usuario
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersView() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(() => get<{ data: UserPublicDTO[] }>("/auth/users").then((r) => r.data));

  return (
    <>
      <PageHead title="Usuarios" hint="Cuentas registradas en el User Service. El personal lo da de alta el administrador; los clientes se registran solos.">
        {can("users:manage") && (
          <button className="primary" onClick={() => setCreating(true)}>
            + Nuevo usuario
          </button>
        )}
      </PageHead>
      <State loading={loading} error={error} empty={data?.length === 0 && "No hay usuarios."} onRetry={() => void reload()} />
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>
                    <Badge tone={u.status === "active" ? "ok" : "bad"}>{u.status === "active" ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td>{dateTime(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <NewUser
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void reload(true);
          }}
        />
      )}
    </>
  );
}
