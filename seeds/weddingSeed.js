const Menu = require("../models/Menu");
const WeddingHall = require("../models/WeddingHall");
const WeddingHallDate = require("../models/WeddingHallDate");
const WeddingBooking = require("../models/WeddingBooking");

const restaurantId = "restaurant-1";
const standardIncludes = ["Assorted Naan", "Raita", "Pickle", "One Salad of your Choice", "One Dessert of your Choice"];
const menu = (name, price, mainDishes) => ({
  name,
  pricePerPerson: price,
  priceNote: "+ Tax / per person",
  includes: [...mainDishes, ...standardIncludes],
  isActive: true,
});

const weddingPackages = [
  menu("Menu 1", 1499, ["Chicken Qorma", "Chicken Pullao"]),
  menu("Menu 2", 2400, ["Chicken Qorma", "Seekh Kabab Biryani"]),
  menu("Menu 3", 2900, ["Chicken Qorma Badami", "Mutton Biryani"]),
  menu("Menu 4", 2500, ["Chicken Kashmiri Qorma", "Steam Roast Chicken Biryani"]),
  menu("Menu 5", 2999, ["Chicken Qorma", "Mutton Chilman Biryani"]),
  menu("Menu 6", 4100, ["Mutton Qorma", "Chicken Pullao"]),
  menu("Menu 7", 4449, ["Mutton Qorma Badami", "Seekh Kabab Biryani"]),
  menu("Menu 8", 4299, ["Mutton Shahi Qorma", "Chicken Chilman Biryani"]),
  menu("Menu 9", 4349, ["Mutton Qorma", "Steam Roast", "Chicken Biryani"]),
];

const extraPrices = [
  { label: "Soup or Arrival (per person) + Tax", price: 330 },
  { label: "Assorted Soft Drinks (per person) + Tax", price: 330 },
  { label: "Mineral Water (per bottle) + Tax", price: 200 },
  { label: "Black Tea / Green Tea (per person) + Tax", price: 150 },
  { label: "Kashmiri Tea (per person) + Tax", price: 200 },
];
const weddingSaladOptions = ["ChickPea Salad", "Red Beans Salad", "Pasta Salad", "Apple Cabbage Salad", "Kachumber Salad", "Sweet Corn Salad", "Fresh Green Salad", "Russian Salad"];
const weddingDessertOptions = ["Fruit Trifle", "Shahi Kheer", "Cream Caramel", "Bread Butter Pudding", "Hot Gulab Jamun", "Mutanjan", "Firni"];

const weddingOffer = {
  title: "Grandest Wedding Offer",
  startingPrice: 1499,
  priceNote: "+ Tax",
  menuDescription: "Chicken One Dish Menu",
  perks: [
    { text: "Complimentary Standard Room for Couple", minimumGuests: 100 },
    { text: "Complimentary access to photoshoot at hotel" },
    { text: "20% discount on restaurant bill for couple", discountPercent: 20 },
    { text: "No Hall rental", minimumGuests: 75 },
    { text: "One cake complimentary" },
    { text: "Terms & Conditions apply" },
  ],
  isActive: true,
};

const halls = [
  { name: "Orchid Hall", capacity: 300, rentalPrice: 60000, priceNote: "+ Tax", isActive: true },
  { name: "Magnolia Hall 1", capacity: 300, rentalPrice: 60000, priceNote: "+ Tax", isActive: true },
  { name: "Magnolia Hall 2", capacity: 300, rentalPrice: 60000, priceNote: "+ Tax", isActive: true },
];
const corporateMenu = {
  restaurantId,
  category: "Corporate",
  title: "Corporate Event Menu",
  subtitle: "Good Food Builds Great Conversations",
  description: "",
  menuTimeSlots: ["9:00 AM to 5:00 PM"],
  price: 2850,
  priceNote: "+ Tax / per person",
  corporatePackages: [],
  corporatePackageDefaultsVersion: 2,
  corporateMeals: [
    { meal: "Morning Tea", dishes: ["Tea", "Samosa"] },
    { meal: "Lunch", dishes: ["Chicken Shashlik", "Egg Fried Rice", "Chicken Biryani", "Chicken Qorma", "Raita/ Salad", "Dessert"] },
    { meal: "Evening Tea", dishes: ["Tea", "Cookies"] },
  ],
  corporateMenuPreferences: ["Breakfast", "Morning Tea", "Lunch", "Hi-Tea", "Dinner"],
  corporateTaxPercent: null,
  corporateDefaultsVersion: 2,
  isActive: true,
};
const corporateSetupOptions = ["Theatre", "Classroom", "U-Shape", "Boardroom", "Banquet"];
const boardrooms = [
  { name: "Opera", capacity: null, corporateRentalPrice: null, venueType: "boardroom" },
  { name: "Palm 1", capacity: null, corporateRentalPrice: null, venueType: "boardroom" },
  { name: "Palm 2", capacity: null, corporateRentalPrice: null, venueType: "boardroom" },
];
const septemberAvailability = {
  "Orchid Hall": { booked: [1, 5, 9, 12, 26], blocked: [] },
  "Magnolia Hall 1": { booked: [6, 7, 13, 17, 21, 22, 25], blocked: [] },
  "Magnolia Hall 2": { booked: [4, 8, 16, 24, 30], blocked: [] },
  "Opera": { booked: [6, 12, 22, 23, 27], blocked: [] },
  "Palm 1": { booked: [7, 10, 13, 14, 15, 19, 24], blocked: [] },
  "Palm 2": { booked: [1, 3, 4, 8, 11, 21, 25, 26, 28, 30], blocked: [] },
};
const blockedSeptemberDays = [10, 11, 15, 28];
const blockedBoardroomDays = [16];

const plain = (item) => item?.toObject ? item.toObject() : item;
const mergeDefaults = (defaults, existingItems, key, fields) => {
  const existingByName = new Map(existingItems.map((item) => [item[key], plain(item)]));
  const seededNames = new Set(defaults.map((item) => item[key]));
  return [
    ...defaults.map((item) => ({ ...existingByName.get(item[key]), ...item, ...(fields || {}) })),
    ...existingItems.map(plain).filter((item) => !seededNames.has(item[key])),
  ];
};

async function seedWeddingData() {
  await WeddingBooking.updateMany({ bookingType: { $exists: false } }, { $set: { bookingType: "wedding" } });
  const existingMenu = await Menu.findOne({ restaurantId, category: "Wedding Package" });
  if (!existingMenu) {
    await Menu.create({
      restaurantId,
      category: "Wedding Package",
      title: "Wedding Special Menu",
      badge: "Lahore's First Revolving Restaurant",
      subtitle: "",
      closingLine: "",
      description: "All menu prices are per person + Tax. Every menu includes assorted naan, raita, pickle, one salad of your choice and one dessert of your choice.",
      menuTimeSlots: ["1:00 PM to 4:00 PM", "7:00 PM to 10:00 PM"],
      price: 0,
      priceNote: "",
      weddingPackages,
      extraPrices,
      weddingSaladOptions,
      weddingDessertOptions,
      weddingVenues: halls.map(({ name, capacity, rentalPrice, priceNote }) => ({ name, capacity, rentalPrice, priceNote, isActive: true })),
      grandestOffer: { ...weddingOffer, isActive: false },
      weddingTaxPercent: null,
      weddingDefaultsVersion: 2,
      isActive: true,
    });
  } else if (existingMenu.weddingDefaultsVersion < 2) {
    const oldPackages = existingMenu.weddingPackages || [];
    const oldAddOns = existingMenu.extraPrices || [];
    const oldVenues = existingMenu.weddingVenues || [];
    const oldOffer = plain(existingMenu.grandestOffer) || {};
    const oldPerks = oldOffer.perks || [];
    const mergedPerks = mergeDefaults(weddingOffer.perks, oldPerks, "text");
    const seededPerkTexts = new Set(weddingOffer.perks.map((item) => item.text));
    await Menu.updateOne({ _id: existingMenu._id }, {
      $set: {
        title: "Wedding Special Menu",
        badge: "Lahore's First Revolving Restaurant",
        subtitle: "",
        closingLine: "",
        description: "All menu prices are per person + Tax. Every menu includes assorted naan, raita, pickle, one salad of your choice and one dessert of your choice.",
        menuTimeSlots: ["1:00 PM to 4:00 PM", "7:00 PM to 10:00 PM"],
        weddingPackages: mergeDefaults(weddingPackages, oldPackages, "name"),
        extraPrices: mergeDefaults(extraPrices, oldAddOns, "label"),
        weddingVenues: halls.map((hall) => {
          const previous = oldVenues.map(plain).find((item) => item.name === hall.name);
          return { ...previous, ...hall, capacity: Number(previous?.capacity) > 0 ? previous.capacity : hall.capacity };
        }).concat(oldVenues.map(plain).filter((item) => !halls.some((hall) => hall.name === item.name))),
        weddingSaladOptions: [...new Set([...weddingSaladOptions, ...(existingMenu.weddingSaladOptions || [])])],
        weddingDessertOptions: [...new Set([...weddingDessertOptions, ...(existingMenu.weddingDessertOptions || [])])],
        grandestOffer: {
          ...oldOffer,
          ...weddingOffer,
          isActive: typeof oldOffer.isActive === "boolean" ? oldOffer.isActive : weddingOffer.isActive,
          perks: [...mergedPerks, ...oldPerks.map(plain).filter((item) => !seededPerkTexts.has(item.text))],
        },
        weddingTaxPercent: existingMenu.weddingTaxPercent ?? null,
        grandestOffer: { ...(oldOffer || weddingOffer), isActive: false },
        weddingDefaultsVersion: 2,
        isActive: true,
      },
    });
  }
  for (const hall of halls) {
    const existingHall = await WeddingHall.findOne({ restaurantId, name: hall.name });
    if (!existingHall) {
      await WeddingHall.create({ restaurantId, ...hall, defaultDataVersion: 1 });
    } else if (existingHall.defaultDataVersion < 1) {
      existingHall.rentalPrice = hall.rentalPrice;
      existingHall.priceNote = hall.priceNote;
      existingHall.defaultDataVersion = 1;
      await existingHall.save();
    }
  }
  await seedCorporateData();
  console.log("✅ Wedding and corporate menus, venue inventory and availability seeded.");
}

async function seedCorporateData() {
  const existingMenu = await Menu.findOne({ restaurantId, category: "Corporate" });
  if (!existingMenu) await Menu.create(corporateMenu);
  else if (existingMenu.corporateDefaultsVersion < 2) {
    existingMenu.title = corporateMenu.title;
    existingMenu.description = corporateMenu.description;
    existingMenu.subtitle = corporateMenu.subtitle;
    existingMenu.menuTimeSlots = corporateMenu.menuTimeSlots;
    existingMenu.price = corporateMenu.price;
    existingMenu.priceNote = corporateMenu.priceNote;
    existingMenu.corporateMeals = corporateMenu.corporateMeals;
    existingMenu.corporateMenuPreferences = corporateMenu.corporateMenuPreferences;
    existingMenu.corporateTaxPercent = null;
    existingMenu.corporateDefaultsVersion = 2;
    if (existingMenu.isActive === undefined) existingMenu.isActive = true;
    await existingMenu.save();
  }
  const corporateMenuAfterBaseSeed = await Menu.findOne({ restaurantId, category: "Corporate" });
  if (corporateMenuAfterBaseSeed.corporatePackageDefaultsVersion < 2) {
    corporateMenuAfterBaseSeed.corporatePackages = [
      ...(corporateMenuAfterBaseSeed.corporatePackages || []).filter((item) => item.title !== "Corporate Event & Meeting Package"),
      ...corporateMenu.corporatePackages,
    ];
    corporateMenuAfterBaseSeed.corporatePackageDefaultsVersion = 2;
    await corporateMenuAfterBaseSeed.save();
  }

  const corporateHalls = halls.map((hall) => ({
    ...hall,
    corporateRentalPrice: null,
    setupOptions: corporateSetupOptions,
    corporateDefaultsVersion: 1,
  }));
  const allVenues = [...corporateHalls, ...boardrooms.map((venue) => ({
    ...venue,
    rentalPrice: null,
    priceNote: "",
    setupOptions: corporateSetupOptions,
    isActive: true,
    corporateDefaultsVersion: 1,
  }))];
  for (const venue of allVenues) {
    const existing = await WeddingHall.findOne({ restaurantId, name: venue.name });
    if (!existing) {
      await WeddingHall.create({ restaurantId, ...venue });
    } else if (existing.corporateDefaultsVersion < 1) {
      existing.venueType = venue.venueType || "wedding_hall";
      existing.corporateRentalPrice = null;
      existing.setupOptions = corporateSetupOptions;
      existing.corporateDefaultsVersion = 1;
      if (existing.venueType === "boardroom") {
        existing.capacity = null;
        existing.rentalPrice = null;
        existing.priceNote = "";
      }
      await existing.save();
    }
  }

  const seedMarker = await WeddingHall.findOne({ restaurantId, name: "Opera" });
  if (seedMarker && seedMarker.corporateDefaultsVersion < 2) {
    const month = new Date(Date.UTC(2026, 8, 1));
    const hallDocs = await WeddingHall.find({ restaurantId, name: { $in: Object.keys(septemberAvailability) } }).select("_id name").lean();
    const existingRows = await WeddingHallDate.find({
      restaurantId,
      hallId: { $in: hallDocs.map((hall) => hall._id) },
      date: { $gte: month, $lt: new Date(Date.UTC(2026, 9, 1)) },
    }).lean();
    const existingByKey = new Map(existingRows.map((row) => [`${row.hallId}:${row.date.toISOString().slice(0, 10)}`, row]));
    const updates = [];
    for (const hall of hallDocs) {
      const values = septemberAvailability[hall.name];
      const isBoardroom = ["Opera", "Palm 1", "Palm 2"].includes(hall.name);
      for (let day = 1; day <= 30; day += 1) {
        const status = blockedSeptemberDays.includes(day) && !isBoardroom
          ? "blocked"
          : blockedBoardroomDays.includes(day) && isBoardroom
            ? "blocked"
            : values.booked.includes(day) ? "booked" : "available";
        const date = new Date(month);
        date.setUTCDate(day);
        const existing = existingByKey.get(`${hall._id}:${date.toISOString().slice(0, 10)}`);
        if (existing?.bookingId) continue;
        updates.push(existing
          ? { updateOne: { filter: { _id: existing._id }, update: { $set: { status, note: "September 2026 corporate availability seed." } } } }
          : { updateOne: { filter: { restaurantId, hallId: hall._id, date }, update: { $set: { status, note: "September 2026 corporate availability seed." } }, upsert: true } });
      }
    }
    if (updates.length) await WeddingHallDate.bulkWrite(updates, { ordered: false });
    seedMarker.corporateDefaultsVersion = 2;
    await seedMarker.save();
  }
}

module.exports = { seedWeddingData, seedCorporateData, weddingPackages, extraPrices, weddingSaladOptions, weddingDessertOptions, weddingOffer, halls, corporateMenu, corporateSetupOptions, septemberAvailability };
