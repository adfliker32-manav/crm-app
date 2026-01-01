const express = require('express');
const mongoose = require('mongoose'); // 👈 Mongoose Import kiya
const cors = require('cors');

// Routes Import
const leadRoutes = require('./src/routes/leadRoutes');
const authRoutes = require('./src/routes/authRoutes');
const emailRoutes = require('./src/routes/emailRoutes'); // 👈 Email Route bhi joda

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 🔥 DATABASE CONNECTION (Cloud MongoDB)
// Maine aapka link yahan daal diya hai (crm folder ke sath)
const MONGO_URI = "mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected to Cloud! ☁️'))
  .catch(err => console.error('❌ Cloud DB Error:', err));

// Routes Use
app.use('/api/auth', authRoutes);
app.use('/api', leadRoutes);
app.use('/api/email', emailRoutes); // 👈 Email Route Active

// 🔥 SERVER START (Dynamic Port for Cloud)
const PORT = process.env.PORT || 3000; // 👈 Ye line Cloud ke liye jaruri hai
app.listen(PORT, () => {
  console.log(`🚀 Server Running on Port ${PORT}`);
});