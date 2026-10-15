require("dotenv").config();
const mongoose = require("mongoose");
const Menu = require("../models/Menu");
const MENU_CATEGORIES = require("../config/menuCategories");

const cloudinaryImage = "https://res.cloudinary.com/dohdm64xs/image/upload/q_auto/f_auto/";
const menus = {
  "Hi-Tea Buffet": {
    title: "Lavish All Day Buffet",
    price: 2200,
    priceNote: "+ Tax",
    description: `🏨 *Hotel d'Gates* — Lavish All Day Buffet!
Mutton Item included | 60+ Dishes

🍽️ *Delicious Specialities:*
- Pakistani food variety with Mutton item
- Chinese food variety
- BBQ
- Pan Asian food variety
- Spice lovers variety (Chaat Bar) 🌶️
- Sweets lovers variety (Dessert Bar) 🍮
- Kids special (Pizza, Burger, Fries, Patties, Chocolate Fountain) 🍕
- Variety of fried items
- Variety of Naan
- Juices / Lemonade included 🥤
- Tea / Green Tea included ☕
- 60+ items`,
    dishes: [
      "Pakistani food variety with Mutton item", "Chinese food variety", "BBQ",
      "Pan Asian food variety", "Spice lovers variety (Chaat Bar)",
      "Sweets lovers variety (Dessert Bar)", "Kids special", "Variety of fried items",
      "Variety of Naan", "Juices / Lemonade", "Tea / Green Tea", "60+ items",
    ],
    media: {
      imageUrls: [`${cloudinaryImage}v1779133899/alll_day_buffet_n0pucs.jpg`],
      videoUrl: "https://res.cloudinary.com/dohdm64xs/video/upload/q_auto/f_auto/v1779133920/vedio_qjdujw.mp4",
      voiceNoteUrl: "https://res.cloudinary.com/dohdm64xs/video/upload/q_auto/f_auto/v1779133881/hi_tea_voice_wleket.ogg",
    },
    offers: [{ title: "Daily Offer", discountText: "Buy 5 Get 1 FREE", isActive: true }],
  },
  "Dinner Buffet": {
    title: "Dinner Buffet",
    media: { imageUrls: [`${cloudinaryImage}v1779132308/dinner_gfbcmp.jpg`] },
    captionAfterImage: "Are you interested? If yes, I'll start your booking process.",
  },
  "Wedding Package": {
    title: "Wedding Package",
    media: { imageUrls: [`${cloudinaryImage}v1779132990/weding_1_mlhirl.jpg`] },
    captionAfterImage: "Select & booking Now",
  },
  "Pool/Gym": {
    title: "Fitness + Pool",
    extraPrices: [
      { label: "Gym (monthly)", price: 7999 },
      { label: "Pool (per person)", price: 2500 },
      { label: "Kids Deal", price: 15000 },
      { label: "Family Deal", price: 30000 },
      { label: "Mega Family Deal", price: 90000 },
    ],
    media: { imageUrls: [`${cloudinaryImage}v1779133086/pool_fmmhqo.jpg`] },
  },
  Rooms: {
    title: "Family Staycation Package",
    price: 11500,
    priceNote: "Starting from, + Tax",
    description: "*Plan Your Perfect Family Staycation on a Budget* 🏨\nStarting from *Rs. 11,500 + Tax*\n\n🛏️ 1.5 Star Category Rooms\n☕ Breakfast Buffet\n🍽️ Lavish Room Service Menu\n📶 Free WiFi\n\nShare your dates and number of guests to book your stay. 😊",
    dishes: ["Breakfast Buffet", "Lavish Room Service Menu", "Free WiFi"],
    roomPriceBasis: "",
    roomDefaultsVersion: 2,
  },
  "Auditorium / Movie Night + Hi-Tea": {
    title: "Exclusive Movie Night + Lavish Hi-Tea Buffet",
    description: "*Exclusive Movie Night + Lavish Hi-Tea Buffet* 🎬☕\nStarting from *Rs. 2550*\nMinimum 50 guests. For fewer than 50 guests, rates can vary.\nPerfect for family gatherings, student groups and corporate events. 😊",
    price: 2550,
    priceNote: "Starting from, minimum 50 guests. Below 50, rates can vary.",
    auditoriumPriceBasis: "",
    auditoriumStartingFrom: true,
    auditoriumDefaultsVersion: 1,
    auditoriumMinimumGuests: 50,
    auditoriumHighlights: [],
    auditoriumOfferVariants: [],
    dishes: [],
    offers: [
      { title: "Family Mega Gathering Offers", description: "Exclusive Movie Night + Lavish Hi-Tea Buffet", discountText: "Rs. 2550 Starting from. Minimum 50 guests. For fewer than 50 guests, rates can vary.", isActive: true },
      { title: "Student Special Offer", description: "Exclusive Movie Night + Lavish Hi-Tea Buffet", discountText: "Rs. 2550 Starting from. Minimum 50 guests. For fewer than 50 guests, rates can vary.", isActive: true },
      { title: "Make your Corporate gathering memorable", description: "Exclusive Movie Night + Lavish Hi-Tea Buffet", discountText: "Rs. 2550 Starting from. Minimum 50 guests. For fewer than 50 guests, rates can vary.", isActive: true },
    ],
    media: { imageUrls: [], pdfUrls: [], videoUrl: "", voiceNoteUrl: "" },
    captionAfterImage: "",
  },
  "D'Fusion Revolving Restaurant: A La Carte Menu": {
    title: "D'Fusion Revolving Restaurant: A La Carte Menu",
    description: "Editable a la carte menu. Add, update or remove dishes, deals and pricing as needed.",
    price: 0,
    priceNote: "Editable price",
    restaurantPriceBasis: "",
    restaurantDefaultsVersion: 1,
    restaurantDeals: [],
    restaurantItemPricing: [],
    media: {
      imageUrls: [],
      pdfUrls: [],
      videoUrl: "",
      voiceNoteUrl: "",
    },
    captionAfterImage: "",
    offers: [],
  },
  "À la carte / Restaurant Reservation": {
    title: "Crazy Deals @ Lahore's 1st Revolving Restaurant",
    description: "*Try Our Crazy Deals* 🍽️\n@ Lahore's 1st Revolving Restaurant\n\n🥢 *Chinese Lovers* — Rs. 3849 + Tax\n🍲 *Desi Food Lovers* — Rs. 4634 + Tax\n🍕 *Fast Food Lovers* — Rs. 4298 + Tax\n🥩 *Steak & Pasta Lover* — Rs. 5249 + Tax\n\nReply with your preferred deal, guest count and dining time to reserve your table. 😊",
    price: 3849,
    priceNote: "Deals from Rs. 3849 + Tax",
    restaurantPriceBasis: "",
    restaurantDefaultsVersion: 1,
    restaurantDeals: [
      { title: "Chinese Lovers", description: "Hot & Sour Soup, Honey Glazed Wings, Chicken Noodles, KungPao Chicken, Cream Caramel", items: ["Hot & Sour Soup", "Honey Glazed Wings", "Chicken Noodles", "KungPao Chicken", "Cream Caramel"], price: 3849, priceBasis: "", isActive: true },
      { title: "Desi Food Lovers", description: "Chicken Karahi, Chicken Tikka Boti, Daal Mash Handi, Raita/Salad, Kheer", items: ["Chicken Karahi", "Chicken Tikka Boti", "Daal Mash Handi", "Raita/Salad", "Kheer"], price: 4634, priceBasis: "", isActive: true },
      { title: "Fast Food Lovers", description: "BBQ Chicken Ranch Pizza, Grilled Chicken Sandwich, Chicken Noodles, Cream Caramel", items: ["BBQ Chicken Ranch Pizza", "Grilled Chicken Sandwich", "Chicken Noodles", "Cream Caramel"], price: 4298, priceBasis: "", isActive: true },
      { title: "Steak & Pasta Lover", description: "Beef T-Bone Steak, Penne Arrabiata, Cream Caramel", items: ["Beef T-Bone Steak", "Penne Arrabiata", "Cream Caramel"], price: 5249, priceBasis: "", isActive: true },
    ],
    restaurantItemPricing: [],
    media: {
      imageUrls: [],
      pdfUrls: [],
      videoUrl: "",
      voiceNoteUrl: "",
    },
    captionAfterImage: "",
    offers: [],
  },
};

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  for (const category of MENU_CATEGORIES) {
    const defaults = menus[category] || {};
    await Menu.findOneAndUpdate(
      { restaurantId: "restaurant-1", category },
      { $setOnInsert: { ...defaults, restaurantId: "restaurant-1", category, isActive: category === "Hi-Tea Buffet" || category === "Rooms" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  console.log(`Seeded ${MENU_CATEGORIES.length} restaurant-1 menus (existing menus left unchanged).`);
}

seed()
  .catch((error) => {
    console.error("Menu seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
