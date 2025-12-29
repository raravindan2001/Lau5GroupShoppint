require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Razorpay = require('razorpay');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("DB Error:", err));

// --- MODELS ---
const ShopSchema = new mongoose.Schema({
  name: String,
  razorpayAccountId: String,
  location: { type: { type: String, default: 'Point' }, coordinates: [Number] },
  offers: [{ title: String, price: Number, minGroupSize: Number }]
});
ShopSchema.index({ location: '2dsphere' });
const Shop = mongoose.model('Shop', ShopSchema);

// --- RAZORPAY SETUP ---
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- ROUTES ---

// 1. Get Nearby Shops
app.post('/shops/nearby', async (req, res) => {
  const { lat, lng } = req.body;
  try {
    const shops = await Shop.find({
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: 5000 // 5km
        }
      }
    });
    res.json(shops);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Create Split Payment Order
app.post('/payment/create-order', async (req, res) => {
  const { amount, shopAccountId } = req.body;
  // 10% Commission to Platform, 90% to Shop
  const shopShare = Math.floor(amount * 0.90 * 100); 
  
  try {
    const order = await razorpay.orders.create({
      amount: amount * 100, // in paise
      currency: "INR",
      transfers: [{
        account: shopAccountId,
        amount: shopShare,
        currency: "INR",
        on_hold: 0
      }]
    });
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Add a Dummy Shop (For testing)
app.post('/admin/add-shop', async (req, res) => {
  const shop = new Shop(req.body);
  await shop.save();
  res.json({ message: "Shop Added", shop });
});

// --- REAL-TIME SOCKET ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join_group', (groupId) => {
    socket.join(groupId);
    // Notify others in group
    io.to(groupId).emit('group_update', { message: "New user joined!" });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));