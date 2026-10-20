import type { Dish } from "../generated/client/index.js";
import { AppError } from "@resto/core";
import type {
  CreateDishInput,
  DishCategory,
  DishDTO,
  UpdateDishInput,
} from "@resto/contracts";
import { dishRepository } from "../repositories/dish.repository.js";

function toDTO(dish: Dish): DishDTO {
  return {
    id: dish.id,
    name: dish.name,
    description: dish.description,
    priceCents: dish.priceCents,
    category: dish.category,
    available: dish.available,
    createdAt: dish.createdAt.toISOString(),
    updatedAt: dish.updatedAt.toISOString(),
  };
}

async function getOrThrow(id: string): Promise<Dish> {
  const dish = await dishRepository.findById(id);
  if (!dish) throw AppError.notFound("Platillo");
  return dish;
}

/** CAPA 3 — SERVICE: reglas de negocio del catálogo de platillos. */
export const dishService = {
  async list(filter: {
    category?: DishCategory;
    available?: boolean;
  }): Promise<DishDTO[]> {
    return (await dishRepository.findMany(filter)).map(toDTO);
  },

  async get(id: string): Promise<DishDTO> {
    return toDTO(await getOrThrow(id));
  },

  async create(input: CreateDishInput): Promise<DishDTO> {
    if (await dishRepository.findByName(input.name)) {
      throw AppError.conflict("Ya existe un platillo con ese nombre");
    }
    return toDTO(await dishRepository.create(input));
  },

  async update(id: string, input: UpdateDishInput): Promise<DishDTO> {
    const current = await getOrThrow(id);
    if (input.name && input.name !== current.name) {
      if (await dishRepository.findByName(input.name)) {
        throw AppError.conflict("Ya existe un platillo con ese nombre");
      }
    }
    return toDTO(await dishRepository.update(id, input));
  },

  async setAvailability(id: string, available: boolean): Promise<DishDTO> {
    await getOrThrow(id);
    return toDTO(await dishRepository.update(id, { available }));
  },

  async remove(id: string): Promise<void> {
    await getOrThrow(id);
    await dishRepository.delete(id);
  },
};
