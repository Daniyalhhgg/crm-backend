const Menu = require("../models/Menu");

const restaurantId = "restaurant-1";
const staycationMenu = {
  restaurantId,
  category: "Rooms",
  title: "Plan Your Perfect Family Staycation on a Budget",
  subtitle: "Quality Stays for Happier Moments",
  price: 13500,
  priceNote: "Starting from + Tax",
  description: "Starting from Rs. 13,500 + Tax",
  dishes: ["1.5 Star Category Rooms", "Breakfast Buffet", "Lavish Room Service Menu", "Free WiFi"],
  roomPriceBasis: "",
  roomCheckInTime: "2:00 PM",
  roomCheckOutTime: "2:00 PM",
  roomStayDurationHours: 22,
  roomDefaultsVersion: 3,
  isActive: true,
};

async function seedRoomStaycationMenu() {
  const existing = await Menu.findOne({ restaurantId, category: "Rooms" });
  if (!existing) {
    await Menu.create(staycationMenu);
    return;
  }
  if (Number(existing.roomDefaultsVersion || 0) < staycationMenu.roomDefaultsVersion) {
    await Menu.updateOne({ _id: existing._id }, {
      $set: {
        ...staycationMenu,
      },
    });
  }
}

module.exports = { seedRoomStaycationMenu, staycationMenu };
