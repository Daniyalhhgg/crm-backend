const mongoose = require("mongoose");
const Menu = require("../models/Menu");
const MENU_CATEGORIES = require("../config/menuCategories");
const { parseConfiguredTimeSlots } = require("../services/fixedTimeSlots");

const isRestaurantCategory = (category) => ["À la carte / Restaurant Reservation", "D'Fusion Revolving Restaurant: A La Carte Menu"].includes(category);

const emitMenuUpdate = (req, menu, category) => {
  const io = req.app.get("io");
  if (io) io.to("chat-admins").emit("menu_updated", {
    restaurantId: req.admin.restaurantId,
    category,
    menu,
  });
};

const validateOffer = (offer) => {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) return "Offer data is required";
  if (offer.title !== undefined && String(offer.title).length > 120) return "Offer title must be 120 characters or fewer";
  if (offer.discountText !== undefined && String(offer.discountText).length > 240) return "Offer discount text must be 240 characters or fewer";
  if (offer.validFrom && Number.isNaN(new Date(offer.validFrom).getTime())) return "Invalid offer validFrom date";
  if (offer.validTo && Number.isNaN(new Date(offer.validTo).getTime())) return "Invalid offer validTo date";
  if (offer.validFrom && offer.validTo && new Date(offer.validFrom) > new Date(offer.validTo)) return "Offer validFrom must be before validTo";
  return null;
};

exports.getMenus = async (req, res) => {
  try {
    const menus = await Menu.find({ restaurantId: req.admin.restaurantId }).sort({ category: 1 });
    res.json({ success: true, data: menus });
  } catch (error) {
    console.error("getMenus error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMenu = async (req, res) => {
  try {
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: req.params.category });
    if (!menu) return res.status(404).json({ success: false, message: "Menu not found" });
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error("getMenu error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertMenu = async (req, res) => {
  try {
    const { category } = req.params;
    if (!MENU_CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: "Invalid menu category" });
    const allowed = ["title", "subtitle", "badge", "closingLine", "description", "dishes", "menuTimeSlots", "menuSections", "buffetDefaultsVersion", "price", "priceNote", "extraPrices", "weddingPackages", "weddingVenues", "weddingSaladOptions", "weddingDessertOptions", "weddingDefaultsVersion", "grandestOffer", "weddingTaxPercent", "corporateMeals", "corporateMenuPreferences", "corporateTaxPercent", "corporateDefaultsVersion", "corporatePackages", "corporatePackageDefaultsVersion", "roomPriceBasis", "roomCheckInTime", "roomCheckOutTime", "roomStayDurationHours", "roomDefaultsVersion", "restaurantDeals", "restaurantItemPricing", "restaurantPriceBasis", "restaurantDefaultsVersion", "auditoriumOfferVariants", "auditoriumMinimumGuests", "auditoriumPriceBasis", "auditoriumStartingFrom", "auditoriumDefaultsVersion", "auditoriumHighlights", "media", "captionAfterImage", "isActive", "loyalty"];
    const set = { updatedBy: req.admin._id };
    for (const key of allowed) if (req.body[key] !== undefined) set[key] = req.body[key];
    if (set.price !== undefined && (!Number.isFinite(Number(set.price)) || Number(set.price) < 0)) {
      return res.status(400).json({ success: false, message: "price must be a non-negative number" });
    }
    if (set.dishes !== undefined && (!Array.isArray(set.dishes) || set.dishes.some((item) => typeof item !== "string"))) {
      return res.status(400).json({ success: false, message: "dishes must be an array of strings" });
    }
    if (set.menuTimeSlots !== undefined && (!Array.isArray(set.menuTimeSlots) || set.menuTimeSlots.length > 30 || set.menuTimeSlots.some((slot) => typeof slot !== "string" || slot.trim().length > 120))) {
      return res.status(400).json({ success: false, message: "menuTimeSlots must be a list of up to 30 text slots, each 120 characters or fewer." });
    }
    if (set.menuTimeSlots !== undefined && ["Hi-Tea Buffet", "Dinner Buffet", "Wedding Package"].includes(category) && !parseConfiguredTimeSlots(set.menuTimeSlots)) {
      return res.status(400).json({ success: false, message: "Time slots must be non-overlapping time ranges, such as 3:00 PM to 5:00 PM." });
    }
    if (set.menuSections !== undefined && (!Array.isArray(set.menuSections) || set.menuSections.length > 50 || set.menuSections.some((section) =>
      !section || typeof section.title !== "string" || !section.title.trim() || section.title.trim().length > 120 ||
      (section.description !== undefined && (typeof section.description !== "string" || section.description.length > 1000)) ||
      !Array.isArray(section.items) || section.items.length > 100 || section.items.some((item) => typeof item !== "string" || item.length > 240)
    ))) {
      return res.status(400).json({ success: false, message: "menuSections must contain titled sections with item lists." });
    }
    if (set.extraPrices !== undefined && (!Array.isArray(set.extraPrices) || set.extraPrices.some((item) => !item?.label || !Number.isFinite(Number(item.price)) || Number(item.price) < 0))) {
      return res.status(400).json({ success: false, message: "extraPrices must contain a label and non-negative price" });
    }
    if (set.weddingPackages !== undefined) {
      if (category !== "Wedding Package" || !Array.isArray(set.weddingPackages) || set.weddingPackages.some((item) =>
        !item?.name || String(item.name).trim().length > 120 ||
        !Number.isFinite(Number(item.pricePerPerson)) || Number(item.pricePerPerson) < 0 ||
        (item.includes !== undefined && (!Array.isArray(item.includes) || item.includes.some((include) => typeof include !== "string")))
      )) return res.status(400).json({ success: false, message: "Wedding packages need a name, non-negative per-person price and a list of inclusions." });
    }
    if (set.weddingVenues !== undefined) {
      if (category !== "Wedding Package" || !Array.isArray(set.weddingVenues) || set.weddingVenues.some((item) =>
        !item?.name || String(item.name).trim().length > 120 ||
        !Number.isFinite(Number(item.rentalPrice)) || Number(item.rentalPrice) < 0 ||
        (item.capacity !== null && item.capacity !== "" && item.capacity !== undefined && (!Number.isInteger(Number(item.capacity)) || Number(item.capacity) < 1))
      )) return res.status(400).json({ success: false, message: "Wedding venues need a name, optional positive guest capacity and non-negative rental price." });
    }
    for (const key of ["weddingSaladOptions", "weddingDessertOptions"]) {
      if (set[key] !== undefined && (category !== "Wedding Package" || !Array.isArray(set[key]) || set[key].some((item) => typeof item !== "string" || item.trim().length > 120))) {
        return res.status(400).json({ success: false, message: `${key} must be a list of text options for the Wedding Package menu.` });
      }
    }
    if (set.weddingTaxPercent !== undefined && set.weddingTaxPercent !== null && (!Number.isFinite(Number(set.weddingTaxPercent)) || Number(set.weddingTaxPercent) < 0 || Number(set.weddingTaxPercent) > 100)) {
      return res.status(400).json({ success: false, message: "weddingTaxPercent must be between 0 and 100." });
    }
    if (["roomCheckInTime", "roomCheckOutTime"].some((key) => set[key] !== undefined && (category !== "Rooms" || typeof set[key] !== "string" || !set[key].trim() || set[key].trim().length > 40))) {
      return res.status(400).json({ success: false, message: "Room check-in and check-out times must be non-empty text values of up to 40 characters." });
    }
    if (set.roomStayDurationHours !== undefined && (category !== "Rooms" || !Number.isInteger(Number(set.roomStayDurationHours)) || Number(set.roomStayDurationHours) < 1 || Number(set.roomStayDurationHours) > 168)) {
      return res.status(400).json({ success: false, message: "roomStayDurationHours must be a whole number from 1 to 168 for the Rooms menu." });
    }
    if (set.corporateMeals !== undefined && (category !== "Corporate" || !Array.isArray(set.corporateMeals) || set.corporateMeals.some((meal) =>
      !meal?.meal || typeof meal.meal !== "string" || !Array.isArray(meal.dishes) || meal.dishes.some((dish) => typeof dish !== "string")
    ))) return res.status(400).json({ success: false, message: "Corporate meals must have a meal name and a list of dishes." });
    if (set.corporatePackages !== undefined && (category !== "Corporate" || !Array.isArray(set.corporatePackages) || set.corporatePackages.some((item) =>
      !item?.title || typeof item.title !== "string" || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 ||
      !["", "per person", "per group"].includes(item.priceBasis || "") ||
      (item.features !== undefined && (!Array.isArray(item.features) || item.features.some((feature) => typeof feature !== "string")))
    ))) return res.status(400).json({ success: false, message: "Corporate packages need a title, non-negative price, valid price basis, and feature list." });
    if (set.roomPriceBasis !== undefined && (category !== "Rooms" || !["", "per night", "per stay", "per room", "per person"].includes(set.roomPriceBasis))) {
      return res.status(400).json({ success: false, message: "roomPriceBasis must be a supported basis for the Rooms menu." });
    }
    if (set.corporateMenuPreferences !== undefined && (category !== "Corporate" || !Array.isArray(set.corporateMenuPreferences) || set.corporateMenuPreferences.some((item) => typeof item !== "string"))) {
      return res.status(400).json({ success: false, message: "Corporate menu preferences must be a list of text options." });
    }
    if (set.corporateTaxPercent !== undefined && (category !== "Corporate" || (set.corporateTaxPercent !== null && (!Number.isFinite(Number(set.corporateTaxPercent)) || Number(set.corporateTaxPercent) < 0 || Number(set.corporateTaxPercent) > 100)))) {
      return res.status(400).json({ success: false, message: "corporateTaxPercent must be between 0 and 100 for a Corporate menu." });
    }
    if (set.restaurantDeals !== undefined && (!isRestaurantCategory(category) || !Array.isArray(set.restaurantDeals) || set.restaurantDeals.some((deal) =>
      !deal?.title || typeof deal.title !== "string" || deal.title.trim().length === 0 ||
      !Number.isFinite(Number(deal.price)) || Number(deal.price) < 0 ||
      (!deal.items || !Array.isArray(deal.items) || deal.items.some((item) => typeof item !== "string"))
    ))) {
      return res.status(400).json({ success: false, message: "restaurantDeals must be an array of deal objects with title, price and item list for the A La Carte menu." });
    }
    if (set.restaurantItemPricing !== undefined && (!isRestaurantCategory(category) || !Array.isArray(set.restaurantItemPricing) || set.restaurantItemPricing.some((item) =>
      !item?.name || typeof item.name !== "string" ||
      !Number.isFinite(Number(item.price)) || Number(item.price) < 0
    ))) {
      return res.status(400).json({ success: false, message: "restaurantItemPricing must be a list of item-name and non-negative price pairs." });
    }
    if (set.restaurantPriceBasis !== undefined && (!isRestaurantCategory(category) || typeof set.restaurantPriceBasis !== "string" || (set.restaurantPriceBasis.trim() !== "" && !["per person", "per deal"].includes(set.restaurantPriceBasis.trim())))) {
      return res.status(400).json({ success: false, message: "restaurantPriceBasis must be empty, per person, or per deal for the A La Carte menu." });
    }
    if (set.auditoriumOfferVariants !== undefined && (category !== "Auditorium / Movie Night + Hi-Tea" || !Array.isArray(set.auditoriumOfferVariants) || set.auditoriumOfferVariants.some((offer) => !offer?.title || typeof offer.title !== "string" || Number.isNaN(Number(offer.price)) || Number(offer.price) < 0))) {
      return res.status(400).json({ success: false, message: "auditoriumOfferVariants must be a list of valid offers for the Auditorium menu." });
    }
    if (set.auditoriumMinimumGuests !== undefined && (category !== "Auditorium / Movie Night + Hi-Tea" || !Number.isInteger(Number(set.auditoriumMinimumGuests)) || Number(set.auditoriumMinimumGuests) < 1)) {
      return res.status(400).json({ success: false, message: "auditoriumMinimumGuests must be a positive integer for the Auditorium menu." });
    }
    if (set.auditoriumStartingFrom !== undefined && (category !== "Auditorium / Movie Night + Hi-Tea" || typeof set.auditoriumStartingFrom !== "boolean")) {
      return res.status(400).json({ success: false, message: "auditoriumStartingFrom must be a boolean for the Auditorium menu." });
    }
    if (set.auditoriumPriceBasis !== undefined && (category !== "Auditorium / Movie Night + Hi-Tea" || typeof set.auditoriumPriceBasis !== "string" || (set.auditoriumPriceBasis.trim() !== "" && !["per person", "per group", "starting from"].includes(set.auditoriumPriceBasis.trim())))) {
      return res.status(400).json({ success: false, message: "auditoriumPriceBasis must be empty, per person, per group, or starting from for the Auditorium menu." });
    }
    if (set.auditoriumHighlights !== undefined && (category !== "Auditorium / Movie Night + Hi-Tea" || !Array.isArray(set.auditoriumHighlights) || set.auditoriumHighlights.some((item) => typeof item !== "string"))) {
      return res.status(400).json({ success: false, message: "auditoriumHighlights must be an array of strings for the Auditorium menu." });
    }
    if (set.grandestOffer !== undefined && category !== "Wedding Package") {
      return res.status(400).json({ success: false, message: "grandestOffer is only valid for the Wedding Package menu." });
    }
    if (set.loyalty !== undefined) {
      const loyalty = set.loyalty;
      if (!loyalty || typeof loyalty !== "object" || Array.isArray(loyalty) || typeof loyalty.enabled !== "boolean") {
        return res.status(400).json({ success: false, message: "loyalty must include an enabled boolean" });
      }
      if (!Number.isInteger(Number(loyalty.visitsForReward)) || Number(loyalty.visitsForReward) < 1 || Number(loyalty.visitsForReward) > 100) {
        return res.status(400).json({ success: false, message: "loyalty.visitsForReward must be an integer from 1 to 100" });
      }
      if (typeof loyalty.rewardText !== "string" || !loyalty.rewardText.trim() || loyalty.rewardText.length > 160) {
        return res.status(400).json({ success: false, message: "loyalty.rewardText is required and must be 160 characters or fewer" });
      }
      set.loyalty = {
        enabled: loyalty.enabled,
        visitsForReward: Number(loyalty.visitsForReward),
        rewardText: loyalty.rewardText.trim(),
      };
    }
    const menu = await Menu.findOneAndUpdate(
      { restaurantId: req.admin.restaurantId, category },
      { $set: set, $setOnInsert: { restaurantId: req.admin.restaurantId, category } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (category === "Wedding Package" && set.weddingVenues !== undefined) {
      const WeddingHall = require("../models/WeddingHall");
      await Promise.all(set.weddingVenues.map((venue) => WeddingHall.updateOne(
        { restaurantId: req.admin.restaurantId, name: venue.name },
        { $set: { rentalPrice: Number(venue.rentalPrice) || 0, priceNote: venue.priceNote || "" } }
      )));
    }
    emitMenuUpdate(req, menu, category);
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error("upsertMenu error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMenu = async (req, res) => {
  try {
    const menu = await Menu.findOneAndDelete({ restaurantId: req.admin.restaurantId, category: req.params.category });
    if (!menu) return res.status(404).json({ success: false, message: "Menu not found" });
    emitMenuUpdate(req, null, req.params.category);
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error("deleteMenu error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addOffer = async (req, res) => {
  try {
    const invalid = validateOffer(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: req.params.category });
    if (!menu) return res.status(404).json({ success: false, message: "Menu not found" });
    menu.offers.push(req.body);
    menu.updatedBy = req.admin._id;
    await menu.save();
    emitMenuUpdate(req, menu, menu.category);
    res.status(201).json({ success: true, data: menu });
  } catch (error) {
    console.error("addOffer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateOffer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.offerId)) return res.status(400).json({ success: false, message: "Invalid offer id" });
    const invalid = validateOffer(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: req.params.category });
    if (!menu) return res.status(404).json({ success: false, message: "Menu not found" });
    const offer = menu.offers.id(req.params.offerId);
    if (!offer) return res.status(404).json({ success: false, message: "Offer not found" });
    const allowed = ["title", "description", "discountText", "validFrom", "validTo", "isActive", "voiceNoteUrl", "imageUrl"];
    for (const key of allowed) if (req.body[key] !== undefined) offer[key] = req.body[key];
    menu.updatedBy = req.admin._id;
    await menu.save();
    emitMenuUpdate(req, menu, menu.category);
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error("updateOffer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteOffer = async (req, res) => {
  try {
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: req.params.category });
    if (!menu) return res.status(404).json({ success: false, message: "Menu not found" });
    const offer = menu.offers.id(req.params.offerId);
    if (!offer) return res.status(404).json({ success: false, message: "Offer not found" });
    offer.deleteOne();
    menu.updatedBy = req.admin._id;
    await menu.save();
    emitMenuUpdate(req, menu, menu.category);
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error("deleteOffer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.toggleOffer = async (req, res) => {
  try {
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: req.params.category });
    if (!menu) return res.status(404).json({ success: false, message: "Menu not found" });
    const offer = menu.offers.id(req.params.offerId);
    if (!offer) return res.status(404).json({ success: false, message: "Offer not found" });
    offer.isActive = !offer.isActive;
    menu.updatedBy = req.admin._id;
    await menu.save();
    emitMenuUpdate(req, menu, menu.category);
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error("toggleOffer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicMenus = async (req, res) => {
  try {
    if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    const { restaurantId = "restaurant-1", category } = req.query;
    if (category && !MENU_CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: "Invalid menu category" });
    const query = { restaurantId };
    if (category) query.category = category;
    const menus = await Menu.find(query).sort({ category: 1 }).lean();
    const now = new Date();
    const data = menus.map((menu) => {
      const activeOffers = (menu.offers || []).filter((offer) =>
        offer.isActive &&
        (!offer.validFrom || new Date(offer.validFrom) <= now) &&
        (!offer.validTo || new Date(offer.validTo) >= now)
      );
      const priceLine = isRestaurantCategory(menu.category)
        ? menu.priceNote || (menu.price ? `Deals from Rs. ${menu.price} + Tax` : "")
        : menu.price ? `Rs ${menu.price}${menu.priceNote ? ` ${menu.priceNote}` : ""}` : menu.priceNote;
      const offerLines = activeOffers.map((offer) => [offer.title, offer.discountText, offer.description].filter(Boolean).join(" — "));
      const weddingPackageLines = (menu.weddingPackages || []).filter((item) => item.isActive).map((item) =>
        `${item.name}: Rs ${item.pricePerPerson} per person${item.priceNote ? ` ${item.priceNote}` : ""}${item.description ? ` — ${item.description}` : ""}${item.includes?.length ? ` (Includes: ${item.includes.join(", ")})` : ""}`
      );
      const weddingVenueLines = (menu.weddingVenues || []).filter((item) => item.isActive).map((item) =>
        `${item.name}${item.capacity ? ` (up to ${item.capacity} guests)` : ""}: Rs ${item.rentalPrice}${item.priceNote ? ` ${item.priceNote}` : ""}${item.description ? ` — ${item.description}` : ""}`
      );
      const grandestLines = menu.grandestOffer?.isActive ? [
        `${menu.grandestOffer.title}: starting Rs ${menu.grandestOffer.startingPrice}${menu.grandestOffer.priceNote ? ` ${menu.grandestOffer.priceNote}` : ""} (${menu.grandestOffer.menuDescription})`,
        ...(menu.grandestOffer.perks || []).map((perk) => `${perk.text}${perk.minimumGuests ? ` (for ${perk.minimumGuests}+ guests)` : ""}`),
      ] : [];
      const weddingChoices = menu.category === "Wedding Package" ? [
        (menu.weddingSaladOptions || []).length ? `Salad choices: ${menu.weddingSaladOptions.join(", ")}` : "",
        (menu.weddingDessertOptions || []).length ? `Dessert choices: ${menu.weddingDessertOptions.join(", ")}` : "",
        ...(menu.extraPrices || []).map((item) => `${item.label}: Rs ${item.price}`),
      ] : [];
      const corporateMealLines = menu.category === "Corporate" ? (menu.corporateMeals || []).map((meal) => `${meal.meal}: ${(meal.dishes || []).join(", ")}`) : [];
      const corporatePackageLines = menu.category === "Corporate" ? (menu.corporatePackages || []).filter((item) => item.isActive !== false).map((item) =>
        `${item.title}\n${item.description || `Starting from Rs. ${item.price}${item.priceNote ? ` ${item.priceNote}` : ""}${item.priceBasis ? ` (${item.priceBasis})` : ""}${item.features?.length ? `\n${item.features.map((feature) => `✅ ${feature}`).join("\n")}` : ""}`}`
      ) : [];
      const corporatePreferenceLine = menu.category === "Corporate" && (menu.corporateMenuPreferences || []).length
        ? `Menu preferences: ${menu.corporateMenuPreferences.join(", ")}`
        : "";
      const restaurantDealLines = isRestaurantCategory(menu.category)
        ? (menu.restaurantDeals || []).filter((deal) => deal.isActive !== false).map((deal) =>
          `${deal.title}: Rs. ${deal.price} + Tax${deal.priceBasis ? ` (${deal.priceBasis})` : ""}${deal.items?.length ? `\n${deal.items.join(", ")}` : ""}`
        )
        : [];
      const restaurantItemLines = isRestaurantCategory(menu.category)
        ? (menu.restaurantItemPricing || []).filter((item) => item.isActive !== false).map((item) => `${item.name}: Rs. ${item.price}`)
        : [];
      const roomInclusionLines = menu.category === "Rooms" ? (menu.dishes || []).filter(Boolean).map((item) => `• ${item}`) : [];
      const roomPriceBasisLine = menu.category === "Rooms" && menu.roomPriceBasis ? `Price basis: ${menu.roomPriceBasis}` : "";
      const roomScheduleLines = menu.category === "Rooms" ? [
        menu.roomCheckInTime ? `Check-in: ${menu.roomCheckInTime}` : "",
        menu.roomCheckOutTime ? `Check-out: ${menu.roomCheckOutTime}` : "",
        menu.roomStayDurationHours ? `Stay duration: ${menu.roomStayDurationHours} hours` : "",
      ] : [];
      const menuPresentation = [
        menu.badge,
        menu.subtitle,
        (menu.menuTimeSlots || []).length ? `Available time slots: ${menu.menuTimeSlots.join(", ")}` : "",
      ];
      const menuSectionLines = (menu.menuSections || []).map((section) =>
        [section.title, section.description, ...(section.items || []).map((item) => `• ${item}`)].filter(Boolean).join("\n")
      );
      const whatsappText = [menu.title, ...menuPresentation, menu.description, priceLine, ...menuSectionLines, ...grandestLines, ...weddingPackageLines, ...weddingVenueLines, ...weddingChoices, ...corporateMealLines, corporatePreferenceLine, ...corporatePackageLines, ...restaurantDealLines, ...restaurantItemLines, ...roomScheduleLines, roomPriceBasisLine, ...roomInclusionLines, ...offerLines, menu.closingLine].filter(Boolean).join("\n");
      return { ...menu, activeOffers, hasActiveOffer: activeOffers.length > 0, whatsappText };
    });
    res.json({ success: true, data: category ? data[0] || null : data });
  } catch (error) {
    console.error("getPublicMenus error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
