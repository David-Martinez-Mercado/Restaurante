import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@resto/core";

// Mocks de los repositorios — el service se prueba SIN base de datos,
// tal como establece el plan (pruebas unitarias de Service con
// repositorio simulado).
vi.mock("../repositories/user.repository.js", () => ({
  userRepository: {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    countByRole: vi.fn(),
    create: vi.fn(),
    updateById: vi.fn(),
  },
}));

vi.mock("../repositories/refreshToken.repository.js", () => ({
  refreshTokenRepository: {
    create: vi.fn(),
    findByJti: vi.fn(),
    revokeByJti: vi.fn(),
    revokeAllForUser: vi.fn(),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-16-chars";

const { userRepository } = await import("../repositories/user.repository.js");
const { refreshTokenRepository } = await import(
  "../repositories/refreshToken.repository.js"
);
const { authService } = await import("../services/auth.service.js");
const { hashPassword } = await import("@resto/auth");

function fakeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    username: "jperez",
    email: "jperez@example.com",
    passwordHash: "",
    role: "waiter" as const,
    status: "active" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("authService.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve tokens cuando las credenciales son correctas", async () => {
    const passwordHash = await hashPassword("Secreta123");
    vi.mocked(userRepository.findByUsername).mockResolvedValue(
      fakeUser({ passwordHash }) as never
    );
    vi.mocked(refreshTokenRepository.create).mockResolvedValue({} as never);

    const result = await authService.login({
      username: "jperez",
      password: "Secreta123",
    });

    expect(result.success).toBe(true);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe("jperez");
    // El DTO de salida nunca debe incluir el hash de la contraseña.
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("lanza INVALID_CREDENTIALS si el usuario no existe", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);

    await expect(
      authService.login({ username: "no-existe", password: "x" })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("lanza INVALID_CREDENTIALS si la contraseña es incorrecta", async () => {
    const passwordHash = await hashPassword("Secreta123");
    vi.mocked(userRepository.findByUsername).mockResolvedValue(
      fakeUser({ passwordHash }) as never
    );

    await expect(
      authService.login({ username: "jperez", password: "Incorrecta" })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("lanza FORBIDDEN si la cuenta está inactiva", async () => {
    const passwordHash = await hashPassword("Secreta123");
    vi.mocked(userRepository.findByUsername).mockResolvedValue(
      fakeUser({ passwordHash, status: "inactive" }) as never
    );

    await expect(
      authService.login({ username: "jperez", password: "Secreta123" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("authService.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lanza CONFLICT si el username ya existe", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(
      fakeUser() as never
    );
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

    await expect(
      authService.register({
        username: "jperez",
        email: "nuevo@example.com",
        password: "Secreta123",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("crea el usuario y devuelve tokens cuando los datos son válidos", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockResolvedValue(fakeUser() as never);
    vi.mocked(refreshTokenRepository.create).mockResolvedValue({} as never);

    const result = await authService.register({
      username: "jperez",
      email: "jperez@example.com",
      password: "Secreta123",
    });

    expect(result.success).toBe(true);
    expect(userRepository.create).toHaveBeenCalledOnce();
  });

  it("el registro público SIEMPRE crea un customer, aunque el cliente pida admin", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockResolvedValue(fakeUser({ role: "customer" }) as never);
    vi.mocked(refreshTokenRepository.create).mockResolvedValue({} as never);

    // Simula un cuerpo manipulado que intenta autoasignarse un rol.
    await authService.register({
      username: "intruso",
      email: "intruso@example.com",
      password: "Secreta123",
      role: "admin",
    } as never);

    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: "customer" })
    );
  });
});

describe("authService.createUser (alta de personal)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crea la cuenta con el rol indicado y sin devolver tokens ni hash", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockResolvedValue(fakeUser({ role: "cook" }) as never);

    const result = await authService.createUser({
      username: "cocinero1",
      email: "cocinero1@example.com",
      password: "Secreta123",
      role: "cook",
    });

    expect(userRepository.create).toHaveBeenCalledWith(expect.objectContaining({ role: "cook" }));
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("passwordHash");
  });
});

describe("authService.ensureBootstrapAdmin", () => {
  const input = { username: "admin", email: "admin@example.com", password: "Secreta123" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockResolvedValue(fakeUser({ role: "admin" }) as never);
  });

  it("crea el admin cuando no existe ninguno", async () => {
    vi.mocked(userRepository.countByRole).mockResolvedValue(0);

    expect(await authService.ensureBootstrapAdmin(input)).toBe(true);
    expect(userRepository.create).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }));
  });

  it("no hace nada si ya hay un admin", async () => {
    vi.mocked(userRepository.countByRole).mockResolvedValue(1);

    expect(await authService.ensureBootstrapAdmin(input)).toBe(false);
    expect(userRepository.create).not.toHaveBeenCalled();
  });
});

describe("AppError.invalidCredentials", () => {
  it("tiene código 401", () => {
    const err = AppError.invalidCredentials();
    expect(err.statusCode).toBe(401);
  });
});
