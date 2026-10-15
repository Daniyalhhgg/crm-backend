const axios = require("axios");
const Booking = require("../models/Booking");
const Chat = require("../models/Chat");
const Menu = require("../models/Menu");
const RoomType = require("../models/RoomType");
const WeddingBooking = require("../models/WeddingBooking");
const WeddingHall = require("../models/WeddingHall");
const MENU_CATEGORIES = require("../config/menuCategories");

const WA_API_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const EXTRA_CATEGORIES = ["Wedding Halls", "Corporate Halls", "Board Rooms"];

const CATEGORY_ALIASES = {
  "Hi-Tea Buffet": ["hi tea", "hitea", "high tea", "afternoon tea"],
  "Dinner Buffet": ["dinner buffet", "dinner"],
  "Wedding Package": ["wedding package", "wedding", "shaadi", "marriage"],
  Corporate: ["corporate", "conference", "business event"],
  "Pool/Gym": ["pool", "swimming", "gym", "fitness"],
  Rooms: ["room", "rooms", "staycation", "stay", "accommodation"],
  "D'Fusion Revolving Restaurant: A La Carte Menu": ["d fusion", "d'fusion", "fusion restaurant", "revolving restaurant", "a la carte", "alacarte", "restaurant reservation", "restaurant", "dining reservation"],
  "À la carte / Restaurant Reservation": ["a la carte", "restaurant reservation", "restaurant", "dining reservation"],
  "Auditorium / Movie Night + Hi-Tea": ["auditorium", "movie night", "cinema", "movie"],
  "Wedding Halls": ["wedding hall", "wedding venue", "shaadi hall", "wedding", "shaadi"],
  "Corporate Halls": ["corporate hall", "event hall", "corporate"],
  "Board Rooms": ["board room", "boardroom", "meeting room", "corporate"],
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `92${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `92${digits}`;
  return digits;
};
const normalizeText = (value) => String(value || "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const hasPhrase = (text, phrase) => {
  const haystack = ` ${normalizeText(text)} `;
  const needle = ` ${normalizeText(phrase)} `;
  return needle.trim().length > 1 && haystack.includes(needle);
};

function extractMenuItems(menu, roomTypes) {
  const names = [
    ...(menu.dishes || []),
    ...(menu.weddingPackages || []).map((item) => item.name),
    ...(menu.weddingVenues || []).map((item) => item.name),
    ...(menu.corporatePackages || []).map((item) => item.title),
    ...(menu.corporateMeals || []).map((item) => item.meal),
    ...(menu.restaurantDeals || []).flatMap((item) => [item.title, ...(item.items || [])]),
    ...(menu.restaurantItemPricing || []).map((item) => item.name),
    ...(menu.auditoriumOfferVariants || []).map((item) => item.title),
    ...(menu.extraPrices || []).map((item) => item.label),
  ];
  if (menu.category === "Rooms") names.push(...roomTypes.map((room) => room.name));
  return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function loadAudienceData(restaurantId) {
  const [menus, roomTypes, bookings, chats, eventBookings, venues] = await Promise.all([
    Menu.find({ restaurantId, isActive: true }).lean(),
    RoomType.find({ restaurantId, isActive: true }).select("name").lean(),
    Booking.find({ restaurantId }).select("customerPhone customerName package bookingCategory selectedItems").lean(),
    Chat.find({ restaurantId }).select("customerPhone customerName customerMessage botReply direction sender createdAt").lean(),
    WeddingBooking.find({ restaurantId }).select("customerPhone customerName bookingType packageName selectedMenuName hallName answers").lean(),
    WeddingHall.find({ restaurantId, isActive: true }).select("name venueType").lean(),
  ]);

  const customers = new Map();
  const getCustomer = (phone, name = "") => {
    const normalized = normalizePhone(phone);
    if (!/^\d{10,15}$/.test(normalized)) return null;
    if (!customers.has(normalized)) customers.set(normalized, {
      phone: normalized,
      name: String(name || "").trim(),
      bookings: [],
      conversations: [],
      latestInboundAt: null,
    });
    const customer = customers.get(normalized);
    if (!customer.name && name) customer.name = String(name).trim();
    return customer;
  };

  for (const booking of bookings) {
    const customer = getCustomer(booking.customerPhone, booking.customerName);
    if (customer) customer.bookings.push(booking);
  }
  for (const event of eventBookings) {
    const customer = getCustomer(event.customerPhone, event.customerName);
    if (!customer) continue;
    const corporate = event.bookingType === "corporate";
    customer.bookings.push({
      bookingCategory: corporate ? "Corporate" : "Wedding Package",
      package: [event.packageName, event.selectedMenuName, event.hallName, ...Object.values(event.answers || {})].filter(Boolean).join(" "),
      selectedItems: [event.packageName, event.selectedMenuName, event.hallName].filter(Boolean).map((name) => ({ name })),
    });
  }
  for (const chat of chats) {
    const customer = getCustomer(chat.customerPhone, chat.customerName);
    if (!customer) continue;
    if ((chat.sender === "customer" || chat.direction === "customer_to_bot") && chat.createdAt) {
      customer.conversations.push(String(chat.customerMessage || ""));
      const timestamp = new Date(chat.createdAt);
      if (!Number.isNaN(timestamp.getTime()) && (!customer.latestInboundAt || timestamp > customer.latestInboundAt)) customer.latestInboundAt = timestamp;
    }
  }

  const menuByCategory = new Map(menus.map((menu) => [menu.category, menu]));
  const categories = [...new Set([...MENU_CATEGORIES, ...EXTRA_CATEGORIES])].map((name) => {
    const menu = menuByCategory.get(name) || {};
    const categoryRoomTypes = name === "Rooms" ? roomTypes : [];
    const venueItems = venues.filter((venue) => {
      if (name === "Wedding Halls") return venue.venueType === "wedding_hall";
      if (name === "Board Rooms") return venue.venueType === "boardroom";
      if (name === "Corporate Halls") return venue.venueType === "wedding_hall";
      return false;
    }).map((venue) => venue.name);
    return { name, items: [...new Set([...extractMenuItems(menu, categoryRoomTypes), ...venueItems])].sort((a, b) => a.localeCompare(b)) };
  });
  return { customers: [...customers.values()], categories };
}

function matchesAudience(customer, category, item) {
  const aliases = CATEGORY_ALIASES[category] || [category];
  const categoryMatches = (text) => aliases.some((alias) => hasPhrase(text, alias));
  const bookings = customer.bookings.filter((booking) => {
    const bookingText = `${booking.bookingCategory || ""} ${booking.package || ""}`;
    return booking.bookingCategory === category || categoryMatches(bookingText);
  });
  const messages = customer.conversations.filter(categoryMatches);
  if (!bookings.length && !messages.length) return false;
  if (!item) return true;
  const matchingBookings = bookings.some((booking) => {
    const selected = (booking.selectedItems || []).map((entry) => entry.name || "").join(" ");
    return hasPhrase(`${selected} ${booking.package || ""}`, item);
  });
  const matchingMessages = messages.some((text) => hasPhrase(text, item));
  return matchingBookings || matchingMessages;
}

async function getSegment(restaurantId, category, item) {
  const { customers, categories } = await loadAudienceData(restaurantId);
  if (!category) return { customers: [], categories, templateConfigured: Boolean(process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME) };
  if (!categories.some((entry) => entry.name === category)) {
    const error = new Error("Choose a valid category.");
    error.status = 400;
    throw error;
  }
  const selectedCategory = categories.find((entry) => entry.name === category);
  if (item && !selectedCategory.items.includes(item)) {
    const error = new Error("Choose an item that belongs to this category.");
    error.status = 400;
    throw error;
  }
  return {
    customers: customers.filter((customer) => matchesAudience(customer, category, item)),
    categories,
    templateConfigured: Boolean(process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME),
  };
}

exports.getBroadcastAudiences = async (req, res) => {
  try {
    const category = String(req.query.category || "").trim();
    const item = String(req.query.item || "").trim();
    const { customers, categories, templateConfigured } = await getSegment(req.admin.restaurantId, category, item);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const openWindow = customers.filter((customer) => customer.latestInboundAt && customer.latestInboundAt.getTime() >= cutoff).length;
    return res.json({
      success: true,
      categories,
      audience: { total: customers.length, openWindow, templateRequired: customers.length - openWindow, templateConfigured },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("getBroadcastAudiences error:", error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Could not calculate campaign audience." });
  }
};

async function sendTextMessage(to, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  if (!token || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp Cloud API credentials are not configured.");
  const response = await axios.post(WA_API_URL, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message },
  }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return response.data;
}

async function sendImageMessage(to, imageUrl, caption = "") {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  if (!token || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp Cloud API credentials are not configured.");
  const response = await axios.post(WA_API_URL, {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, ...(caption ? { caption } : {}) },
  }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return response.data;
}

async function sendTemplateMessage(to, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const name = process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME;
  if (!token || !process.env.WHATSAPP_PHONE_NUMBER_ID || !name) throw new Error("A Meta-approved WhatsApp campaign template and Cloud API credentials are required outside the 24-hour service window.");
  const response = await axios.post(WA_API_URL, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: process.env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE || "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: message.slice(0, 1024) }] }],
    },
  }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return response.data;
}

exports.broadcastMessage = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const message = String(req.body.message || "").trim();
    const imageUrl = String(req.body.imageUrl || "").trim();
    const category = String(req.body.category || "").trim();
    const item = String(req.body.item || "").trim();
    if (req.body.consentConfirmed !== true) return res.status(400).json({ success: false, message: "Confirm that the selected customers have opted in to receive WhatsApp offers." });
    if (!category) return res.status(400).json({ success: false, message: "A customer-interest category is required; broadcasts cannot target everyone." });
    if (!message && !imageUrl) return res.status(400).json({ success: false, message: "Enter a message or image URL." });
    if (message.length > 1024) return res.status(400).json({ success: false, message: "WhatsApp campaign text must be 1,024 characters or fewer." });
    if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) return res.status(400).json({ success: false, message: "Image URL must use HTTPS." });

    const { customers } = await getSegment(restaurantId, category, item);
    if (!customers.length) return res.json({ success: true, message: "No matching customer interests were found.", results: { total: 0, sent: 0, failed: 0, errors: [] } });

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const outsideWindow = customers.filter((customer) => !customer.latestInboundAt || customer.latestInboundAt.getTime() < cutoff);
    if (outsideWindow.length && !process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME) {
      return res.status(503).json({ success: false, message: `${outsideWindow.length} matching customers are outside WhatsApp's 24-hour service window. Configure a Meta-approved WHATSAPP_BROADCAST_TEMPLATE_NAME (one {{1}} body variable) before sending.` });
    }
    if (imageUrl && outsideWindow.length) {
      return res.status(400).json({ success: false, message: "Some selected customers are outside the 24-hour WhatsApp window. Image campaigns require an approved image-header template, which is not configured here; remove the image or narrow the audience to recent conversations." });
    }

    const io = req.app.get("io");
    const results = { total: customers.length, sent: 0, failed: 0, historyFailed: 0, errors: [] };
    for (const customer of customers) {
      const inWindow = customer.latestInboundAt && customer.latestInboundAt.getTime() >= cutoff;
      const reply = message || "Campaign image sent";
      try {
        const delivery = inWindow
          ? imageUrl ? await sendImageMessage(customer.phone, imageUrl, message) : await sendTextMessage(customer.phone, message)
          : await sendTemplateMessage(customer.phone, message);
        results.sent++;
        try {
          const chat = await Chat.create({
            restaurantId,
            customerPhone: customer.phone,
            customerName: customer.name || "WhatsApp Customer",
            customerMessage: "",
            botReply: reply,
            mediaUrl: imageUrl || "",
            messageType: imageUrl ? "image" : "text",
            sender: "admin",
            direction: "admin_to_customer",
            source: "broadcast",
            status: "sent",
            metadata: { category, item, whatsappMessageId: delivery.messages?.[0]?.id || "" },
          });
          if (io) io.to("chat-admins").emit("whatsapp-new-message", {
            phone: customer.phone,
            customerMessage: "",
            botReply: reply,
            mediaUrl: imageUrl || "",
            mediaType: imageUrl ? "image" : "",
            timestamp: chat.createdAt,
            isBot: false,
            chatId: chat._id,
          });
        } catch (error) {
          results.historyFailed++;
          results.errors.push({ phone: customer.phone, error: `WhatsApp message sent, but CRM history could not be saved: ${error.message}` });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ phone: customer.phone, error: error.response?.data?.error?.message || error.message });
      }
      await delay(250);
    }

    return res.json({
      success: true,
      message: `Campaign complete: ${results.sent} sent, ${results.failed} failed.`,
      results,
    });
  } catch (error) {
    console.error("broadcastMessage error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Broadcast failed." });
  }
};
