// const mongoose = require("mongoose");

// const bookingSchema = new mongoose.Schema(
//   {
//     restaurantId: {
//       type: String,
//       required: true,
//       index: true,
//       trim: true,
//     },

//     customerId: {
//       type: String,
//       required: true,
//       index: true,
//     },

//     customerName: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     customerEmail: {
//       type: String,
//       default: "",
//       trim: true,
//       lowercase: true,
//     },

//     customerPhone: {
//       type: String,
//       required: true,
//       index: true,
//       trim: true,
//     },

//     package: {
//       type: String,
//       enum: [
//         "Hi-Tea Buffet",
//         "Dinner Buffet",
//         "Wedding Package",
//         "Room Booking",
//         "Other",
//       ],
//       required: true,
//       index: true,
//     },

//     numberOfPersons: {
//       type: Number,
//       required: true,
//       min: 1,
//       default: 1,
//     },

//     bookingDate: {
//       type: Date,
//       required: true,
//       index: true,
//     },

//     bookingTime: {
//       type: String,
//       required: true,
//     },

//     specialRequests: {
//       type: String,
//       default: "",
//     },

//     price: {
//       type: Number,
//       default: 0,
//     },

//     status: {
//       type: String,
//       enum: ["pending", "confirmed", "cancelled", "completed"],
//       default: "pending",
//       index: true,
//     },

//     bookingSource: {
//       type: String,
//       enum: ["whatsapp-bot", "phone", "website", "in-person"],
//       default: "whatsapp-bot",
//       index: true,
//     },

//     notes: {
//       type: String,
//       default: "",
//     },

//     chatHistoryId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Chat",
//     },

//     confirmedAt: {
//       type: Date,
//       default: null,
//     },

//     confirmedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Admin",
//       default: null,
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// // =========================
// // PRE-SAVE: Normalize package name from n8n AI Agent
// // ✅ FIXED: Using async to avoid "next is not a function" error
// // =========================
// bookingSchema.pre("save", async function () {
//   const packageMap = {
//     "hi-tea buffet": "Hi-Tea Buffet",
//     "dinner buffet": "Dinner Buffet",
//     "wedding package": "Wedding Package",
//     "room booking": "Room Booking",
//   };

//   if (this.package) {
//     const normalized = packageMap[this.package.toLowerCase().trim()];
//     if (normalized) {
//       this.package = normalized;
//     } else if (
//       !["Hi-Tea Buffet", "Dinner Buffet", "Wedding Package", "Room Booking", "Other"].includes(this.package)
//     ) {
//       this.package = "Other";
//     }
//   }
// });

// // =========================
// // INDEXES (OPTIMIZED CRM QUERIES)
// // =========================
// bookingSchema.index({ restaurantId: 1, status: 1, bookingDate: 1 });
// bookingSchema.index({ restaurantId: 1, customerPhone: 1 });
// bookingSchema.index({ restaurantId: 1, createdAt: -1 });

// module.exports = mongoose.model("Booking", bookingSchema);













const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    customerId: {
      type: String,
      required: true,
      index: true,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    customerPhone: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    package: {
      type: String,
      required: true,
      index: true,
    },
    bookingCategory: {
      type: String,
      enum: ["Hi-Tea Buffet", "Dinner Buffet", "Wedding Package", "Corporate", "Pool/Gym", "Rooms", "D'Fusion Revolving Restaurant: A La Carte Menu", "À la carte / Restaurant Reservation", "Auditorium / Movie Night + Hi-Tea", ""],
      default: "",
      trim: true,
      index: true,
    },
    selectedItems: {
      type: [{
        name: { type: String, required: true, trim: true, maxlength: 160 },
        quantity: { type: Number, min: 1, default: 1 },
        unitPrice: { type: Number, min: 0, default: null },
        notes: { type: String, default: "", trim: true, maxlength: 500 },
      }],
      default: [],
    },
    bookingDetails: {
      type: [{
        label: { type: String, required: true, trim: true, maxlength: 100 },
        value: { type: String, required: true, trim: true, maxlength: 500 },
      }],
      default: [],
    },

    numberOfPersons: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    bookingDate: {
      type: Date,
      required: true,
      index: true,
    },

    bookingTime: {
      type: String,
      required: true,
    },

    roomTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomType",
      default: null,
      index: true,
    },
    roomType: { type: String, default: "", trim: true },
    checkOutDate: { type: Date, default: null, index: true },
    numberOfRooms: { type: Number, min: 1, default: 1 },

    specialRequests: {
      type: String,
      default: "",
    },

    price: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["pending", "confirmed", "checked_in", "completed", "cancelled", "no_show"],
      default: "pending",
      index: true,
    },

    bookingSource: {
      type: String,
      enum: ["whatsapp-bot", "phone", "website", "in-person"],
      default: "whatsapp-bot",
      index: true,
    },

    notes: {
      type: String,
      default: "",
    },

    chatHistoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
    },

    confirmedAt: {
      type: Date,
      default: null,
    },

    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    totalAmount: { type: Number, min: 0, default: 0 },
    advanceAmount: { type: Number, min: 0, default: 0 },
    paymentStatus: { type: String, enum: ["unpaid", "advance_received", "paid", "verifying"], default: "unpaid" },
    paymentMethod: { type: String, default: "", trim: true },
    paymentScreenshotUrl: { type: String, default: "", trim: true },
    paymentVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    paymentVerifiedAt: { type: Date, default: null },
    confirmationMessageStatus: { type: String, enum: ["not_sent", "sent", "failed"], default: "not_sent" },
    confirmationMessageError: { type: String, default: "", trim: true, maxlength: 500 },
    checkedInAt: { type: Date, default: null },
    offerApplied: { type: String, default: "", trim: true },
  },
  {
    timestamps: true,
  }
);

// =========================
// PRE-SAVE: Normalize package name from n8n AI Agent
// =========================
bookingSchema.pre("save", async function () {
  const packageMap = {
    // Hi-Tea variations
    "hi-tea buffet": "Hi-Tea Buffet",
    "hi tea buffet": "Hi-Tea Buffet",
    "hitea buffet": "Hi-Tea Buffet",
    "hi tea": "Hi-Tea Buffet",
    "hitea": "Hi-Tea Buffet",

    // Dinner variations
    "dinner buffet": "Dinner Buffet",
    "dinner": "Dinner Buffet",

    // Wedding variations
    "wedding package": "Wedding Package",
    "wedding": "Wedding Package",

    // Room variations
    "room booking": "Room Booking",
    "room": "Room Booking",

    // A la carte restaurant variations
    "a la carte": "À la carte / Restaurant Reservation",
    "à la carte": "À la carte / Restaurant Reservation",
    "d'fusion": "D'Fusion Revolving Restaurant: A La Carte Menu",
    "d fusion": "D'Fusion Revolving Restaurant: A La Carte Menu",
    "fusion revolving restaurant": "D'Fusion Revolving Restaurant: A La Carte Menu",
    "restaurant reservation": "À la carte / Restaurant Reservation",
    "restaurant": "À la carte / Restaurant Reservation",

    // Auditorium / movie night variations
    "auditorium": "Auditorium / Movie Night + Hi-Tea",
    "movie night": "Auditorium / Movie Night + Hi-Tea",
    "movie night + hi-tea": "Auditorium / Movie Night + Hi-Tea",
    "movie night hi tea": "Auditorium / Movie Night + Hi-Tea",
    "movie hi tea": "Auditorium / Movie Night + Hi-Tea",
  };

  if (this.package) {
    const key = this.package.toLowerCase().trim();
    const normalized = packageMap[key];
    if (normalized) {
      // Known package → normalize karo
      this.package = normalized;
    }
    // Unknown → jo customer ne kaha wahi rehne do
    // "Menu 7", "birthday party" etc → as-is save hoga
  }
});

// =========================
// INDEXES (OPTIMIZED CRM QUERIES)
// =========================
bookingSchema.index({ restaurantId: 1, status: 1, bookingDate: 1 });
bookingSchema.index({ restaurantId: 1, customerPhone: 1 });
bookingSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("Booking", bookingSchema);