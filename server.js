const express = require('express');
const webpush = require('web-push');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI)
  .then(async () => { console.log('MongoDB connected'); await User.syncIndexes(); })
  .catch(err => console.error(err));

const userSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  pass: { type: String, required: true },
  emoji: { type: String, default: '✏️' },
  bio: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  isAuction: { type: Boolean, default: false },
  auctionEnd: { type: String, default: null },
  buyer: { type: String, default: null }
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cat: { type: String, default: 'その他' },
  cond: { type: String, default: '良い' },
  desc: { type: String, default: '' },
  price: { type: Number, required: true },
  neg: { type: Boolean, default: false },
  sold: { type: Boolean, default: false },
  emoji: { type: String, default: '📦' },
  img: { type: String, default: null },
  owner: { type: String, required: true },
  hoshii: { type: [String], default: [] },
  comments: { type: [{ user: String, text: String, createdAt: { type: Date, default: Date.now } }], default: [] },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

const subSchema = new mongoose.Schema({ endpoint: String, keys: Object });
const Sub = mongoose.model('Sub', subSchema);
const Product = mongoose.model('Product', productSchema);

app.post('/api/register', async (req, res) => {
  const { name, pass, emoji, bio } = req.body;
  if (!name || !pass) return res.status(400).json({ error: '名前とパスワードが必要です' });
  try {
    const user = await User.create({ name, pass, emoji, bio });
    res.json({ name: user.name, emoji: user.emoji, bio: user.bio });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'そのニックネームはすでに使われています' });
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

app.post('/api/login', async (req, res) => {
  const { name, pass } = req.body;
  const user = await User.findOne({ name, pass });
  if (!user) return res.status(401).json({ error: 'ニックネームまたはパスワードが違います' });
  res.json({ name: user.name, emoji: user.emoji, bio: user.bio });
});

app.post('/api/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  await Sub.findOneAndUpdate({ endpoint }, { endpoint, keys }, { upsert: true });
  res.json({ ok: true });
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 }).lean();
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  const { name, cat, cond, desc, price, neg, emoji, img, owner } = req.body;
  if (!name || !price || !owner) return res.status(400).json({ error: '必須項目が足りません' });
  const p = await Product.create({ name, cat, cond, desc, price, neg, emoji, img, owner });
  const subs = await Sub.find();
  const payload = JSON.stringify({ title: '文フリ 新着！', body: p.emoji + ' ' + p.name + ' ¥' + p.price });
  subs.forEach(s => webpush.sendNotification(s, payload).catch(()=>{}));
  res.json(p);
});

app.put('/api/products/:id', async (req, res) => {
  const { name, cat, cond, desc, price, neg, sold, emoji, img, requester } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.owner !== requester) return res.status(403).json({ error: '編集権限がありません' });
  Object.assign(p, { name, cat, cond, desc, price, neg, sold, emoji, img });
  await p.save();
  res.json(p);
});

app.delete('/api/products/:id', async (req, res) => {
  const { requester } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.owner !== requester) return res.status(403).json({ error: '削除権限がありません' });
  await p.deleteOne();
  res.json({ ok: true });
});

app.post('/api/products/:id/hoshii', async (req, res) => {
  const { user } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  const i = p.hoshii.indexOf(user);
  if (i > -1) p.hoshii.splice(i, 1);
  else p.hoshii.push(user);
  await p.save();
  res.json({ hoshii: p.hoshii });
});

app.post('/api/products/:id/comments', async (req, res) => {
  const { user, text } = req.body;
  if (!user || !text) return res.status(400).json({ error: '必須項目が足りません' });
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  p.comments.push({ user, text });
  await p.save();
  res.json(p.comments);
});

const bidSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  user: { type: String, required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Bid = mongoose.model('Bid', bidSchema);

const contractSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  price: { type: Number, required: true },
  seller: { type: String, required: true },
  buyer: { type: String, default: '' },
  paymentDate: { type: String, default: '' },
  handoverDate: { type: String, default: '' },
  handoverPlace: { type: String, default: '' },
  memo: { type: String, default: '' },
  sellerSign: { type: String, default: '' },
  buyerSign: { type: String, default: '' },
  sellerSigned: { type: Boolean, default: false },
  buyerSigned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Contract = mongoose.model('Contract', contractSchema);

app.post('/api/products/:id/select-buyer', async (req, res) => {
  const { buyer, requester } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.owner !== requester) return res.status(403).json({ error: '権限がありません' });
  p.buyer = buyer;
  p.sold = true;
  await p.save();
  res.json({ ok: true, buyer });
});

app.post('/api/products/:id/bid', async (req, res) => {
  const { user, amount } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (!p.isAuction) return res.status(400).json({ error: 'オークション商品ではありません' });
  if (p.auctionEnd && new Date() > new Date(p.auctionEnd)) return res.status(400).json({ error: 'オークション終了済み' });
  const topBid = await Bid.findOne({ productId: req.params.id }).sort({ amount: -1 });
  if (topBid && amount <= topBid.amount) return res.status(400).json({ error: '現在の最高額より高い金額を入力してください' });
  const bid = await Bid.create({ productId: req.params.id, user, amount });
  res.json(bid);
});

app.get('/api/products/:id/bids', async (req, res) => {
  const bids = await Bid.find({ productId: req.params.id }).sort({ amount: -1 });
  res.json(bids);
});

app.post('/api/contracts', async (req, res) => {
  const { productId, seller, buyer, paymentDate, handoverDate, handoverPlace, memo } = req.body;
  const p = await Product.findById(productId);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  const contract = await Contract.create({ productId, productName: p.name, price: p.price, seller, buyer, paymentDate, handoverDate, handoverPlace, memo });
  res.json(contract);
});

app.get('/api/contracts/:id', async (req, res) => {
  const c = await Contract.findById(req.params.id);
  if (!c) return res.status(404).json({ error: '契約書が見つかりません' });
  res.json(c);
});

app.get('/api/contracts', async (req, res) => {
  const { user } = req.query;
  const contracts = await Contract.find({ $or: [{ seller: user }, { buyer: user }] }).sort({ createdAt: -1 });
  res.json(contracts);
});

app.post('/api/contracts/:id/sign', async (req, res) => {
  const { user, sign } = req.body;
  const c = await Contract.findById(req.params.id);
  if (!c) return res.status(404).json({ error: '契約書が見つかりません' });
  if (c.seller === user) { c.sellerSign = sign; c.sellerSigned = true; }
  else if (c.buyer === user) { c.buyerSign = sign; c.buyerSigned = true; }
  else return res.status(403).json({ error: '権限がありません' });
  await c.save();
  res.json(c);
});
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`文フリ server running on ${PORT}`));
