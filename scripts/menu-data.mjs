// Datos de demostración de Asador La Brasa: menú y mesas.
// Precios en centavos (sin IVA). Categorías válidas: starter, main, dessert, drink, side.
export const RESTAURANT_NAME = "Asador La Brasa";

export const DISHES = [
  { name: "Provoleta a la parrilla", description: "Queso provolone fundido con orégano y chimichurri", priceCents: 13500, category: "starter" },
  { name: "Empanadas de arrachera", description: "3 piezas horneadas con salsa criolla", priceCents: 11900, category: "starter" },
  { name: "Tuétano asado", description: "Hueso de res al horno de leña con pan tostado", priceCents: 14900, category: "starter" },
  { name: "Carpaccio de res", description: "Láminas de filete, arúgula, parmesano y alcaparras", priceCents: 15500, category: "starter" },
  { name: "Chorizo criollo", description: "Chorizo artesanal a la parrilla con pan", priceCents: 9900, category: "starter" },

  { name: "Rib eye 400 g", description: "Corte marmoleado, jugoso y de intenso sabor", priceCents: 42900, category: "main" },
  { name: "T-bone 600 g", description: "Filete y New York unidos por el hueso", priceCents: 52900, category: "main" },
  { name: "Arrachera 300 g", description: "Marinada de la casa, clásica y tierna", priceCents: 31900, category: "main" },
  { name: "Picaña 350 g", description: "Corte brasileño con su capa de grasa dorada", priceCents: 37900, category: "main" },
  { name: "Filete mignon 250 g", description: "El corte más tierno, envuelto en tocino", priceCents: 39900, category: "main" },
  { name: "Tomahawk para dos", description: "1 kg con hueso largo, para compartir", priceCents: 98900, category: "main" },
  { name: "Costillas BBQ", description: "Media rack cocida lenta con salsa ahumada", priceCents: 33900, category: "main" },
  { name: "Hamburguesa de la casa", description: "200 g de res, queso cheddar, tocino y cebolla caramelizada", priceCents: 21900, category: "main" },
  { name: "Pollo a las brasas", description: "Medio pollo marinado con hierbas", priceCents: 22900, category: "main" },

  { name: "Papas al horno con tocino", description: "Con crema agria y cebollín", priceCents: 8900, category: "side" },
  { name: "Ensalada de la casa", description: "Hojas verdes, jitomate cherry y vinagreta de mostaza", priceCents: 7900, category: "side" },
  { name: "Espárragos a la parrilla", description: "Con limón y sal de mar", priceCents: 9500, category: "side" },
  { name: "Elote asado", description: "Con mantequilla, queso cotija y chile", priceCents: 6500, category: "side" },
  { name: "Puré de camote", description: "Con mantequilla de salvia", priceCents: 7500, category: "side" },

  { name: "Flan de cajeta", description: "Receta de la casa", priceCents: 8900, category: "dessert" },
  { name: "Brownie con helado", description: "Chocolate oscuro, nuez y helado de vainilla", priceCents: 9500, category: "dessert" },
  { name: "Pay de queso", description: "Con mermelada de frutos rojos", priceCents: 9900, category: "dessert" },

  { name: "Malbec (copa)", description: "Tinto mendocino de cuerpo intenso", priceCents: 12900, category: "drink" },
  { name: "Cerveza oscura", description: "Artesanal, botella de 355 ml", priceCents: 7900, category: "drink" },
  { name: "Mezcal artesanal", description: "Copa con naranja y sal de gusano", priceCents: 11900, category: "drink" },
  { name: "Limonada mineral", description: "Con hierbabuena", priceCents: 5500, category: "drink" },
  { name: "Refresco", description: "Botella de 355 ml", priceCents: 4500, category: "drink" },
  { name: "Café americano", description: "De grano molido al momento", priceCents: 4000, category: "drink" },
];

export const TABLES = [
  { number: 1, capacity: 2 },
  { number: 2, capacity: 2 },
  { number: 3, capacity: 4 },
  { number: 4, capacity: 4 },
  { number: 5, capacity: 4 },
  { number: 6, capacity: 6 },
  { number: 7, capacity: 6 },
  { number: 8, capacity: 10 },
];

/** Platillos del pedido de ejemplo que deja listo el seed (por nombre). */
export const SAMPLE_ORDER = ["Rib eye 400 g", "Papas al horno con tocino", "Malbec (copa)"];
