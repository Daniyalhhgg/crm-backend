const MENU_CATEGORIES = require("../config/menuCategories");

module.exports = (packageName) => {
  const value = String(packageName || "").trim().toLowerCase();
  if (MENU_CATEGORIES.includes(packageName)) return packageName;
  if (/hi[\s-]?tea|hitea/.test(value)) return "Hi-Tea Buffet";
  if (/pool|gym|swim/.test(value)) return "Pool/Gym";
  if (/wedding/.test(value)) return "Wedding Package";
  if (/room/.test(value)) return "Rooms";
  if (/movie\s*night|auditorium|movie.*hi[-\s]*tea|hi[-\s]*tea.*movie/.test(value)) return "Auditorium / Movie Night + Hi-Tea";
  if (/dinner|buffet/.test(value)) return "Dinner Buffet";
  if (/d['’]fusion|fusion.*restaurant|revolving.*restaurant.*a\s*la\s*carte|revolving.*a\s*la\s*carte/.test(value)) return "D'Fusion Revolving Restaurant: A La Carte Menu";
  if (/a\s*la\s*carte|alacarte|restaurant reservation|restaurant.*reservation|table reservation|reservation/.test(value)) return "À la carte / Restaurant Reservation";
  return null;
};
