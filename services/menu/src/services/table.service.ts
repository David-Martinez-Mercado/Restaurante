import type { DiningTable } from "../generated/client/index.js";
import { AppError } from "@resto/core";
import type {
  CreateTableInput,
  TableDTO,
  TableStatus,
  UpdateTableInput,
} from "@resto/contracts";
import { tableRepository } from "../repositories/table.repository.js";

function toDTO(table: DiningTable): TableDTO {
  return {
    id: table.id,
    number: table.number,
    capacity: table.capacity,
    status: table.status,
    createdAt: table.createdAt.toISOString(),
    updatedAt: table.updatedAt.toISOString(),
  };
}

async function getOrThrow(id: string): Promise<DiningTable> {
  const table = await tableRepository.findById(id);
  if (!table) throw AppError.notFound("Mesa");
  return table;
}

/** CAPA 3 — SERVICE: reglas de negocio de las mesas del salón. */
export const tableService = {
  async list(status?: TableStatus): Promise<TableDTO[]> {
    return (await tableRepository.findMany(status)).map(toDTO);
  },

  async get(id: string): Promise<TableDTO> {
    return toDTO(await getOrThrow(id));
  },

  async create(input: CreateTableInput): Promise<TableDTO> {
    if (await tableRepository.findByNumber(input.number)) {
      throw AppError.conflict("Ya existe una mesa con ese número");
    }
    return toDTO(await tableRepository.create(input));
  },

  async update(id: string, input: UpdateTableInput): Promise<TableDTO> {
    const current = await getOrThrow(id);
    if (input.number && input.number !== current.number) {
      if (await tableRepository.findByNumber(input.number)) {
        throw AppError.conflict("Ya existe una mesa con ese número");
      }
    }
    return toDTO(await tableRepository.update(id, input));
  },

  async setStatus(id: string, status: TableStatus): Promise<TableDTO> {
    await getOrThrow(id);
    return toDTO(await tableRepository.update(id, { status }));
  },

  async remove(id: string): Promise<void> {
    const table = await getOrThrow(id);
    if (table.status === "occupied") {
      throw AppError.conflict("No se puede eliminar una mesa ocupada");
    }
    await tableRepository.delete(id);
  },
};
