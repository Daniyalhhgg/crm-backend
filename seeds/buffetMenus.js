const Menu = require("../models/Menu");

const buffetSections = [
  { title: "Welcome Drink", items: ["Pineapple drink", "Lemonade"] },
  { title: "Pickles & Sauces", items: ["Thousand island dressing", "Apricot sauce", "Veg raita", "Mint raita", "Zeera raita", "Italian vinegar", "Plum sauce", "Tartar sauce", "Spicy tamarind sauce"] },
  { title: "Salads", items: ["Apple Cabbage Salad", "Russian Salad", "Fresh Green Salad", "Potato German Salad", "03 Bean Salad", "Beetroot Salad", "Macaroni Salad", "Sweet corn Salad", "Pasta Salad"] },
  { title: "Sandwiches", items: ["Vegetable & Cheese sandwich", "Chicken Mayo sandwich", "Egg salad sandwich", "Keto sandwich"] },
  { title: "Street Food Corner", items: ["Dahi bhale", "Fruit chaat", "Channa chaat", "Gol Gappe", "Thai spring rolls", "Punjabi samosa", "Chicken & Cheese Samosa"] },
  { title: "Pan Asian", items: ["Chicken Shashlik/ Chicken", "Vegetable in black pepper sauce", "Vegetable Fried Rice", "Thai Style chowmein", "Mexican Cheese Balls/ Potato Cheese Balls"] },
  { title: "Continental Station", items: ["Bechamal Sauce Pasta/ Penne Tomato pasta", "Chicken tikka pizza", "Masala homemade French fries"] },
  { title: "Traditional Delicacies", items: ["Chicken Hyderabadi Biryani/ Chicken Pulao", "Chicken Mughlai Qorma/ Chicken Jalfarezi", "Mutton Hareesa/ Chicken Shahi Daleem", "Lahori Makhani Channe", "Nauratan bhujia/ Aloo bhujia"] },
  { title: "Live BBQ", items: ["Chicken Tikka Boti/Chicken", "Patakha Boti"] },
  { title: "Live Tandoor", items: ["Kalwanji naan", "Roghani naan", "Garlic naan", "Mix herbs naan"] },
  { title: "English Desserts", items: ["Chocolate fountain", "Chocolate mousse", "Strawberry mousse", "Fresh Fruit Trifle", "Chocolate brownie/mini chocolate balls", "Bread and butter pudding", "Cream caramel", "Egg pudding", "04 Types of Mix jellies", "Swiss rolls/Donuts/Tea cake", "Four types of French Pastries", "Mix Shooter Glasses", "Two types of Cakes"] },
  { title: "Kehwa Khana", items: ["English tea & Green tea."] },
];

const dinnerSections = buffetSections.map((section) => {
  if (section.title === "Street Food Corner") return { ...section, items: ["Dahi bhalle", ...section.items.slice(1)] };
  if (section.title === "Pan Asian") return { ...section, items: ["Chicken Shashlik/ Chicken Vegetable in black pepper sauce", ...section.items.slice(2)] };
  if (section.title === "Continental Station") return { ...section, items: ["Bechemal Sauce Pasta/ Penne Tomato pasta", ...section.items.slice(1)] };
  if (section.title === "English Desserts") return { ...section, items: ["Chocolate fountain", "Chocolate mousse", "Strawberry mousse", "Fresh Fruit Trifle", "Chocolate brownie/ mini chocolate balls", ...section.items.slice(5)] };
  return { ...section, items: [...section.items] };
});

const entries = [
  {
    category: "Hi-Tea Buffet",
    title: "Hi Tea Buffet",
    subtitle: "Good Food • Great Company • Beautiful Ambience",
    closingLine: "A Perfect Blend of Taste & Tradition",
    badge: "",
    price: 0,
    priceNote: "",
    description: "",
    menuTimeSlots: ["3:00 PM to 5:00 PM", "5:00 PM to 7:00 PM", "7:00 PM to 9:00 PM"],
    menuSections: buffetSections,
  },
  {
    category: "Dinner Buffet",
    title: "Dinner Buffet",
    subtitle: "",
    closingLine: "",
    badge: "Lahore's First Revolving Restaurant",
    price: 2699,
    priceNote: "+ Tax per person",
    description: "",
    menuTimeSlots: ["7:00 PM to 8:30 PM", "9:00 PM to 10:30 PM"],
    menuSections: [
      { title: "Traditional Special", description: "A rich and flavorful traditional dish, cooked with authentic spices and tender beef, served in authentic Bannu style.", items: ["Beef Pulao (Bannu Style)"] },
      ...dinnerSections,
    ],
  },
];

async function seedBuffetMenus() {
  for (const defaults of entries) {
    const existing = await Menu.findOne({ restaurantId: "restaurant-1", category: defaults.category });
    if (!existing) {
      await Menu.create({
        ...defaults,
        restaurantId: "restaurant-1",
        dishes: defaults.menuSections.flatMap((section) => section.items),
        buffetDefaultsVersion: 2,
        isActive: true,
      });
    } else if (existing.buffetDefaultsVersion < 2) {
      await Menu.updateOne({ _id: existing._id }, {
        $set: {
          ...defaults,
          dishes: defaults.menuSections.flatMap((section) => section.items),
          buffetDefaultsVersion: 2,
        },
      });
    }
  }
}

module.exports = { seedBuffetMenus, buffetSections, entries };
