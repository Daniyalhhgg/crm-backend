const mongoose = require("mongoose");
const MENU_CATEGORIES = require("../config/menuCategories");

const loyaltySchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  visitsForReward: { type: Number, default: 5, min: 1, max: 100 },
  rewardText: { type: String, default: "Chef Special Dessert", trim: true, maxlength: 160 },
}, { _id: false });

const offerSchema = new mongoose.Schema({
  title: { type: String, default: "", trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  discountText: { type: String, default: "", trim: true, maxlength: 240 },
  validFrom: { type: Date, default: null },
  validTo: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  voiceNoteUrl: { type: String, default: "", trim: true },
  imageUrl: { type: String, default: "", trim: true },
});

const weddingPackageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 1000 },
  pricePerPerson: { type: Number, required: true, min: 0 },
  priceNote: { type: String, default: "", trim: true, maxlength: 120 },
  includes: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const weddingVenueSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  capacity: { type: Number, min: 1, default: null },
  rentalPrice: { type: Number, min: 0, default: 0 },
  priceNote: { type: String, default: "", trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 500 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const grandestPerkSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 240 },
  minimumGuests: { type: Number, min: 1, default: null },
  discountPercent: { type: Number, min: 0, max: 100, default: null },
}, { _id: false });

const grandestOfferSchema = new mongoose.Schema({
  title: { type: String, default: "Grandest Wedding Offer", trim: true, maxlength: 120 },
  startingPrice: { type: Number, min: 0, default: 1499 },
  priceNote: { type: String, default: "+ Tax", trim: true, maxlength: 120 },
  menuDescription: { type: String, default: "Chicken One Dish Menu", trim: true, maxlength: 240 },
  perks: { type: [grandestPerkSchema], default: [] },
  isActive: { type: Boolean, default: true },
}, { _id: false });

const corporateMealSchema = new mongoose.Schema({
  meal: { type: String, required: true, trim: true, maxlength: 80 },
  dishes: { type: [String], default: [] },
}, { _id: false });

const corporatePackageSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  price: { type: Number, required: true, min: 0 },
  priceNote: { type: String, default: "", trim: true, maxlength: 240 },
  priceBasis: { type: String, default: "", enum: ["", "per person", "per group"] },
  features: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const restaurantDealSchema = new mongoose.Schema({
  title: { type: String, default: "", trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  items: { type: [String], default: [] },
  price: { type: Number, min: 0, default: 0 },
  priceBasis: { type: String, default: "", trim: true, maxlength: 40 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const restaurantItemPriceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  price: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const auditoriumVariantSchema = new mongoose.Schema({
  title: { type: String, default: "", trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  minimumGuests: { type: Number, min: 1, default: 50 },
  price: { type: Number, min: 0, default: 2550 },
  priceBasis: { type: String, default: "", trim: true, maxlength: 40 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const menuSectionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 1000 },
  items: { type: [String], default: [] },
}, { _id: false });

const menuSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  category: { type: String, required: true, enum: MENU_CATEGORIES, trim: true },
  title: { type: String, default: "", trim: true, maxlength: 160 },
  subtitle: { type: String, default: "", trim: true, maxlength: 240 },
  badge: { type: String, default: "", trim: true, maxlength: 120 },
  closingLine: { type: String, default: "", trim: true, maxlength: 240 },
  description: { type: String, default: "", maxlength: 10000 },
  dishes: { type: [String], default: [] },
  menuTimeSlots: { type: [String], default: [] },
  menuSections: { type: [menuSectionSchema], default: [] },
  buffetDefaultsVersion: { type: Number, default: 0 },
  price: { type: Number, min: 0, default: 0 },
  priceNote: { type: String, default: "", trim: true, maxlength: 240 },
  extraPrices: [{
    label: { type: String, required: true, trim: true, maxlength: 120 },
    price: { type: Number, required: true, min: 0 },
  }],
  weddingPackages: { type: [weddingPackageSchema], default: [] },
  weddingVenues: { type: [weddingVenueSchema], default: [] },
  weddingSaladOptions: { type: [String], default: [] },
  weddingDessertOptions: { type: [String], default: [] },
  weddingDefaultsVersion: { type: Number, default: 0 },
  grandestOffer: { type: grandestOfferSchema, default: undefined },
  weddingTaxPercent: { type: Number, min: 0, max: 100, default: null },
  corporateMeals: { type: [corporateMealSchema], default: [] },
  corporateMenuPreferences: { type: [String], default: [] },
  corporateTaxPercent: { type: Number, min: 0, max: 100, default: null },
  corporateDefaultsVersion: { type: Number, default: 0 },
  corporatePackages: { type: [corporatePackageSchema], default: [] },
  corporatePackageDefaultsVersion: { type: Number, default: 0 },
  roomPriceBasis: { type: String, default: "", enum: ["", "per night", "per stay", "per room", "per person"] },
  roomCheckInTime: { type: String, default: "2:00 PM", trim: true, maxlength: 40 },
  roomCheckOutTime: { type: String, default: "2:00 PM", trim: true, maxlength: 40 },
  roomStayDurationHours: { type: Number, min: 1, max: 168, default: 22 },
  roomDefaultsVersion: { type: Number, default: 0 },
  restaurantDeals: { type: [restaurantDealSchema], default: [] },
  restaurantItemPricing: { type: [restaurantItemPriceSchema], default: [] },
  restaurantPriceBasis: { type: String, default: "", trim: true, maxlength: 40 },
  restaurantDefaultsVersion: { type: Number, default: 0 },
  auditoriumOfferVariants: { type: [auditoriumVariantSchema], default: [] },
  auditoriumMinimumGuests: { type: Number, min: 1, default: 50 },
  auditoriumPriceBasis: { type: String, default: "", trim: true, maxlength: 40 },
  auditoriumStartingFrom: { type: Boolean, default: false },
  auditoriumDefaultsVersion: { type: Number, default: 0 },
  auditoriumHighlights: { type: [String], default: [] },
  media: {
    imageUrls: { type: [String], default: [] },
    pdfUrls: { type: [String], default: [] },
    videoUrl: { type: String, default: "", trim: true },
    voiceNoteUrl: { type: String, default: "", trim: true },
  },
  captionAfterImage: { type: String, default: "", maxlength: 1000 },
  isActive: { type: Boolean, default: true },
  offers: { type: [offerSchema], default: [] },
  loyalty: { type: loyaltySchema, default: undefined },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

menuSchema.index({ restaurantId: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Menu", menuSchema);
