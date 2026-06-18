const mongoose = require('mongoose');
const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  owner: { type: String, required: true },
  type: { type: String, enum: ['amount', 'percent'], default: 'amount' },
  value: { type: Number, required: true },
  expiry: { type: String, default: '' },
  usedBy: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Coupon = mongoose.model('Coupon', couponSchema);

mongoose.connect(process.env.MONGO_URI).then(async () => {
  await Coupon.findOneAndUpdate(
    { code: 'nishiminbunhuri' },
    { code: 'nishiminbunhuri', owner: 'admin', type: 'percent', value: 5, productId: null, expiry: '' },
    { upsert: true }
  );
  console.log('クーポン登録完了！');
  process.exit();
});
