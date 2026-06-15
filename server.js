const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

const userSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  pass: { type: String, required: true },
  emoji: { type: String, default: '✏️' },
  bio: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
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

app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 }).lean();
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  const { name, cat, cond, desc, price, neg, emoji, img, owner } = req.body;
  if (!name || !price || !owner) return res.status(400).json({ error: '必須項目が足りません' });
  const p = await Product.create({ name, cat, cond, desc, price, neg, emoji, img, owner });
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`文フリ server running on ${PORT}`));
