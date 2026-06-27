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
  imgs: { type: [String], default: [] },
  owner: { type: String, required: true },
  hoshii: { type: [String], default: [] },
  comments: { type: [{ user: String, text: String, createdAt: { type: Date, default: Date.now } }], default: [] },
  createdAt: { type: Date, default: Date.now },
  isAuction: { type: Boolean, default: false },
  auctionStartDate: { type: String, default: null },
  auctionStartTime: { type: String, default: null },
  auctionEndDate: { type: String, default: null },
  auctionEndTime: { type: String, default: null },
  auctionEnd: { type: String, default: null },
  auctionStatus: { type: String, default: 'none' },
  currentWinnerIndex: { type: Number, default: 0 },
  buyer: { type: String, default: null }
});

const User = mongoose.model('User', userSchema);

const subSchema = new mongoose.Schema({ endpoint: String, keys: Object });
const Sub = mongoose.model('Sub', subSchema);
const Product = mongoose.model('Product', productSchema);

const UNSAFE_CHARS = /['"`\\<>]/;

app.post('/api/register', async (req, res) => {
  const { name, pass, emoji, bio } = req.body;
  if (!name || !pass) return res.status(400).json({ error: '名前とパスワードが必要です' });
  if (UNSAFE_CHARS.test(name)) return res.status(400).json({ error: 'ニックネームに使用できない文字が含まれています（\' " ` < > は使えません）' });
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
  let products = await Product.find().sort({ createdAt: -1 }).lean();
  const now = new Date();
  const toFlip = [];
  for (const p of products) {
    if (p.isAuction && p.auctionStatus === 'scheduled' && p.auctionStartDate && p.auctionStartTime) {
      const startAt = new Date(p.auctionStartDate + 'T' + p.auctionStartTime + ':00+09:00');
      if (now >= startAt) { p.auctionStatus = 'open'; toFlip.push(p._id); }
    }
  }
  if (toFlip.length) {
    Product.updateMany({ _id: { $in: toFlip } }, { auctionStatus: 'open' }).catch(()=>{});
  }
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  const { name, cat, cond, desc, price, neg, emoji, img, imgs, owner, isAuction, auctionStartDate, auctionStartTime, auctionEndDate, auctionEndTime } = req.body;
  if (!name || !price || !owner) return res.status(400).json({ error: '必須項目が足りません' });
  if (UNSAFE_CHARS.test(name)) return res.status(400).json({ error: '商品名に使用できない文字が含まれています' });
  let auctionEnd = null;
  let auctionStatus = 'none';
  const endDate = auctionEndDate || auctionStartDate;
  if (isAuction && endDate && auctionEndTime) {
    auctionEnd = endDate + 'T' + auctionEndTime + ':00+09:00';
    auctionStatus = 'scheduled';
  }
  const p = await Product.create({
    name, cat, cond, desc, price, neg, emoji, img, imgs: imgs || [], owner,
    isAuction: !!isAuction, auctionStartDate, auctionStartTime, auctionEndDate: endDate, auctionEndTime, auctionEnd, auctionStatus
  });
  const subs = await Sub.find();
  const payload = JSON.stringify({ title: '文フリ 新着！', body: p.emoji + ' ' + p.name + ' ¥' + p.price });
  subs.forEach(s => webpush.sendNotification(s, payload).catch(()=>{}));
  try {
    const users = await User.find({}, 'name');
    const text = `${p.emoji||'📦'} 「${p.name}」が新着出品されました`;
    const docs = users.filter(u => u.name !== owner).map(u => ({ user: u.name, type: 'new-product', text, productId: p._id }));
    if (docs.length) await Notification.insertMany(docs);
  } catch (e) {}
  res.json(p);
});

app.put('/api/products/:id', async (req, res) => {
  const { name, cat, cond, desc, price, neg, sold, emoji, img, imgs, requester, isAuction, auctionStartDate, auctionStartTime, auctionEndDate, auctionEndTime } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.owner !== requester) return res.status(403).json({ error: '編集権限がありません' });
  if (UNSAFE_CHARS.test(name)) return res.status(400).json({ error: '商品名に使用できない文字が含まれています' });

  const endDate = auctionEndDate || auctionStartDate;
  let auctionEnd = p.auctionEnd;
  let auctionStatus = p.auctionStatus;
  if (isAuction) {
    if (!p.isAuction) auctionStatus = 'scheduled';
    if (endDate && auctionEndTime) auctionEnd = endDate + 'T' + auctionEndTime + ':00+09:00';
  } else {
    auctionEnd = null;
    auctionStatus = 'none';
  }

  Object.assign(p, { name, cat, cond, desc, price, neg, sold, emoji, img, imgs: imgs || [], isAuction: !!isAuction, auctionStartDate, auctionStartTime, auctionEndDate: endDate, auctionEndTime, auctionEnd, auctionStatus });
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
  let added = false;
  if (i > -1) p.hoshii.splice(i, 1);
  else { p.hoshii.push(user); added = true; }
  await p.save();
  if (added && p.owner !== user) await notify(p.owner, 'hoshii', `${user}さんが「${p.name}」をほしい！しました`, p._id);
  res.json({ hoshii: p.hoshii });
});

app.post('/api/products/:id/comments', async (req, res) => {
  const { user, text } = req.body;
  if (!user || !text) return res.status(400).json({ error: '必須項目が足りません' });
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  p.comments.push({ user, text });
  await p.save();
  if (p.owner !== user) await notify(p.owner, 'comment', `${user}さんが「${p.name}」にコメントしました`, p._id);
  res.json(p.comments);
});

const bidSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  user: { type: String, required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Bid = mongoose.model('Bid', bidSchema);

// 思い出らん
const memorySchema = new mongoose.Schema({
  user: { type: String, required: true },
  text: { type: String, default: '' },
  img: { type: String, default: null },
  likes: { type: [String], default: [] },
  comments: { type: [{ user: String, text: String, createdAt: { type: Date, default: Date.now } }], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Memory = mongoose.model('Memory', memorySchema);

// 通知履歴
const notificationSchema = new mongoose.Schema({
  user: { type: String, required: true },
  type: { type: String, default: 'info' },
  text: { type: String, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// フリーチャット
const chatSchema = new mongoose.Schema({
  user: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', chatSchema);

app.get('/api/chat', async (req, res) => {
  const msgs = await ChatMessage.find().sort({ createdAt: -1 }).limit(100);
  res.json(msgs.reverse());
});

app.post('/api/chat', async (req, res) => {
  const { user, text } = req.body;
  if (!user || !text || !text.trim()) return res.status(400).json({ error: 'メッセージを入力してください' });
  const msg = await ChatMessage.create({ user, text: text.trim().slice(0, 500) });
  res.json(msg);
});

// 改善連絡・意見掲示板
const feedbackSchema = new mongoose.Schema({
  user: { type: String, required: true },
  text: { type: String, required: true },
  replies: { type: [{ user: String, text: String, createdAt: { type: Date, default: Date.now } }], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

app.get('/api/feedback', async (req, res) => {
  const list = await Feedback.find().sort({ createdAt: -1 });
  res.json(list);
});

app.post('/api/feedback', async (req, res) => {
  const { user, text } = req.body;
  if (!user || !text || !text.trim()) return res.status(400).json({ error: '内容を入力してください' });
  const fb = await Feedback.create({ user, text: text.trim() });
  res.json(fb);
});

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: '管理者パスワードが設定されていません' });
  if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'パスワードが違います' });
  res.json({ ok: true });
});

app.post('/api/feedback/:id/reply', async (req, res) => {
  const { user, text, adminPassword } = req.body;
  if (!process.env.ADMIN_PASSWORD || adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '管理者のみ返信できます' });
  }
  if (!text || !text.trim()) return res.status(400).json({ error: '内容を入力してください' });
  const fb = await Feedback.findById(req.params.id);
  if (!fb) return res.status(404).json({ error: '投稿が見つかりません' });
  fb.replies.push({ user, text: text.trim() });
  await fb.save();
  res.json(fb);
});

async function notify(user, type, text, productId) {
  if (!user) return;
  try { await Notification.create({ user, type, text, productId: productId || null }); } catch (e) {}
}

app.get('/api/notifications', async (req, res) => {
  const { user } = req.query;
  if (!user) return res.json([]);
  const list = await Notification.find({ user }).sort({ createdAt: -1 }).limit(50);
  res.json(list);
});

app.post('/api/notifications/read-all', async (req, res) => {
  const { user } = req.body;
  await Notification.updateMany({ user, read: false }, { read: true });
  res.json({ ok: true });
});

app.post('/api/notifications/:id/read', async (req, res) => {
  const n = await Notification.findById(req.params.id);
  if (n) { n.read = true; await n.save(); }
  res.json({ ok: true });
});

app.get('/api/memories', async (req, res) => {
  const memories = await Memory.find().sort({ createdAt: -1 });
  res.json(memories);
});

app.post('/api/memories', async (req, res) => {
  const { user, text, img } = req.body;
  if (!user || (!text && !img)) return res.status(400).json({ error: 'テキストか画像を入力してください' });
  const m = await Memory.create({ user, text: text || '', img: img || null });
  res.json(m);
});

app.delete('/api/memories/:id', async (req, res) => {
  const { requester } = req.body;
  const m = await Memory.findById(req.params.id);
  if (!m) return res.status(404).json({ error: '投稿が見つかりません' });
  if (m.user !== requester) return res.status(403).json({ error: '削除権限がありません' });
  await m.deleteOne();
  res.json({ ok: true });
});

app.post('/api/memories/:id/like', async (req, res) => {
  const { user } = req.body;
  const m = await Memory.findById(req.params.id);
  if (!m) return res.status(404).json({ error: '投稿が見つかりません' });
  const i = m.likes.indexOf(user);
  if (i > -1) m.likes.splice(i, 1);
  else m.likes.push(user);
  await m.save();
  res.json({ likes: m.likes });
});

app.post('/api/memories/:id/comments', async (req, res) => {
  const { user, text } = req.body;
  if (!text) return res.status(400).json({ error: 'コメントを入力してください' });
  const m = await Memory.findById(req.params.id);
  if (!m) return res.status(404).json({ error: '投稿が見つかりません' });
  m.comments.push({ user, text });
  await m.save();
  res.json(m.comments);
});

// オークション状態を「今の時刻」に合わせて進める（タイマーが止まってても呼ばれた時点で補正する）
async function tickAuction(p) {
  if (!p.isAuction) return p;
  const now = new Date();
  let changed = false;
  if (p.auctionStatus === 'scheduled' && p.auctionStartDate && p.auctionStartTime) {
    const startAt = new Date(p.auctionStartDate + 'T' + p.auctionStartTime + ':00+09:00');
    if (now >= startAt) {
      p.auctionStatus = 'open';
      changed = true;
      const subs = await Sub.find();
      const payload = JSON.stringify({ title: '🔨 オークション開始！', body: p.emoji + ' ' + p.name + ' のオークションが始まりました' });
      subs.forEach(s => webpush.sendNotification(s, payload).catch(()=>{}));
    }
  }
  if (p.auctionStatus === 'open' && p.auctionEnd && now >= new Date(p.auctionEnd)) {
    const bids = await Bid.find({ productId: p._id }).sort({ amount: -1 });
    if (bids.length === 0) { p.auctionStatus = 'done'; }
    else { p.auctionStatus = 'confirming'; p.currentWinnerIndex = 0; }
    changed = true;
  }
  if (changed) await p.save();
  return p;
}

async function tickAuctions(products) {
  for (const p of products) {
    if (p.isAuction && (p.auctionStatus === 'scheduled' || p.auctionStatus === 'open')) {
      await tickAuction(p);
    }
  }
  return products;
}

const contractSchema = new mongoose.Schema({
  contractNumber: { type: String, default: '' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  price: { type: Number, required: true },
  seller: { type: String, required: true },
  buyer: { type: String, default: '' },
  paymentDate: { type: String, default: '' },
  paymentMethod: { type: String, default: '現金' },
  handoverDate: { type: String, default: '' },
  handoverPlace: { type: String, default: '' },
  handoverMethod: { type: String, default: '対面' },
  cancellationPolicy: { type: String, default: '受け渡し日の前日までに申し出た場合に限り、双方合意のうえキャンセルできるものとする。' },
  memo: { type: String, default: '' },
  sellerSign: { type: String, default: '' },
  buyerSign: { type: String, default: '' },
  sellerSigned: { type: Boolean, default: false },
  buyerSigned: { type: Boolean, default: false },
  sellerSignedAt: { type: Date, default: null },
  buyerSignedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Contract = mongoose.model('Contract', contractSchema);

app.post('/api/products/:id/buy', async (req, res) => {
  const { buyer } = req.body;
  if (!buyer) return res.status(400).json({ error: '購入者情報が必要です' });
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.sold) return res.status(400).json({ error: 'すでに売り切れです' });
  if (p.owner === buyer) return res.status(400).json({ error: '自分の商品は購入できません' });
  if (!p.hoshii.includes(buyer)) p.hoshii.push(buyer);
  await p.save();
  const subs = await Sub.find();
  const payload = JSON.stringify({ title: '文フリ 購入希望！', body: buyer + 'さんが「' + p.name + '」を買いたいと言っています！' });
  subs.forEach(s => webpush.sendNotification(s, payload).catch(()=>{}));
  res.json(p);
});

app.post('/api/products/:id/select-buyer', async (req, res) => {
  const { buyer, requester } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.owner !== requester) return res.status(403).json({ error: '権限がありません' });
  p.buyer = buyer;
  p.sold = true;
  await p.save();
  await notify(buyer, 'selected', `「${p.name}」の購入者に選ばれました！`, p._id);
  res.json({ ok: true, buyer });
});

app.post('/api/products/:id/bid', async (req, res) => {
  const { user, amount } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (!p.isAuction) return res.status(400).json({ error: 'オークション商品ではありません' });
  if (p.auctionStatus !== 'open') return res.status(400).json({ error: '現在入札できません' });
  if (p.auctionEnd && new Date() > new Date(p.auctionEnd)) return res.status(400).json({ error: 'オークション終了済み' });
  if (amount > 30000) return res.status(400).json({ error: '入札は3万円までです' });
  if (p.owner === user) return res.status(400).json({ error: '自分の商品には入札できません' });
  const topBid = await Bid.findOne({ productId: req.params.id }).sort({ amount: -1 });
  if (topBid && amount <= topBid.amount) return res.status(400).json({ error: '現在の最高額より高い金額を入力してください' });
  const bid = await Bid.create({ productId: req.params.id, user, amount });
  await notify(p.owner, 'bid', `${user}さんが「${p.name}」に¥${amount.toLocaleString()}で入札しました`, p._id);
  if (topBid && topBid.user !== user) await notify(topBid.user, 'outbid', `「${p.name}」で他の人がより高い金額で入札しました`, p._id);
  res.json(bid);
});

// オークション開始（時刻が来たらstatusをopenに）
app.post('/api/products/:id/auction-start', async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  p.auctionStatus = 'open';
  await p.save();
  res.json(p);
});

// オークション終了（時刻が来たら最高額者に確認を出す）
app.post('/api/products/:id/auction-end', async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  const bids = await Bid.find({ productId: req.params.id }).sort({ amount: -1 });
  if (bids.length === 0) {
    p.auctionStatus = 'done';
    await p.save();
    return res.json({ p, message: '入札がありませんでした' });
  }
  p.auctionStatus = 'confirming';
  p.currentWinnerIndex = 0;
  await p.save();
  res.json({ p, topBidder: bids[0] });
});

// 最高額者の最終確認（購入する/しない）
app.post('/api/products/:id/auction-confirm', async (req, res) => {
  const { user, accept } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  const bids = await Bid.find({ productId: req.params.id }).sort({ amount: -1 });
  const current = bids[p.currentWinnerIndex];
  if (!current || current.user !== user) return res.status(403).json({ error: '今は確認の対象者ではありません' });
  if (accept) {
    p.buyer = user;
    p.sold = true;
    p.auctionStatus = 'done';
    await p.save();
    await notify(p.owner, 'auction-won', `${user}さんが「${p.name}」の購入を確定しました。契約書を作成しましょう`, p._id);
    return res.json({ ok: true, decided: true, buyer: user });
  } else {
    p.currentWinnerIndex += 1;
    if (p.currentWinnerIndex >= bids.length) {
      p.auctionStatus = 'done';
      await p.save();
      return res.json({ ok: true, decided: false, message: '購入者が決まりませんでした' });
    }
    await p.save();
    res.json({ ok: true, decided: false, nextBidder: bids[p.currentWinnerIndex] });
  }
});

// 出品者が手動で次の人に進める
app.post('/api/products/:id/auction-next', async (req, res) => {
  const { requester } = req.body;
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  if (p.owner !== requester) return res.status(403).json({ error: '権限がありません' });
  const bids = await Bid.find({ productId: req.params.id }).sort({ amount: -1 });
  p.currentWinnerIndex += 1;
  if (p.currentWinnerIndex >= bids.length) {
    p.auctionStatus = 'done';
    await p.save();
    return res.json({ ok: true, decided: false, message: '購入者が決まりませんでした' });
  }
  await p.save();
  res.json({ ok: true, nextBidder: bids[p.currentWinnerIndex] });
});

// 現在の確認対象者を取得
app.get('/api/products/:id/auction-current', async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  await tickAuction(p);
  const bids = await Bid.find({ productId: req.params.id }).sort({ amount: -1 });
  const current = bids[p.currentWinnerIndex] || null;
  res.json({ status: p.auctionStatus, current, allBids: bids });
});

app.get('/api/products/:id/bids', async (req, res) => {
  const bids = await Bid.find({ productId: req.params.id }).sort({ amount: -1 });
  res.json(bids);
});

app.post('/api/contracts', async (req, res) => {
  const { productId, seller, buyer, paymentDate, paymentMethod, handoverDate, handoverPlace, handoverMethod, cancellationPolicy, memo } = req.body;
  const p = await Product.findById(productId);
  if (!p) return res.status(404).json({ error: '商品が見つかりません' });
  const contractNumber = 'FF-' + Date.now().toString(36).toUpperCase();
  const contract = await Contract.create({ contractNumber, productId, productName: p.name, price: p.price, seller, buyer, paymentDate, paymentMethod, handoverDate, handoverPlace, handoverMethod, cancellationPolicy, memo });
  await notify(buyer, 'contract', `「${p.name}」の契約書が作成されました。サインしてください`, p._id);
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
  if (c.seller === user) { c.sellerSign = sign; c.sellerSigned = true; c.sellerSignedAt = new Date(); }
  else if (c.buyer === user) { c.buyerSign = sign; c.buyerSigned = true; c.buyerSignedAt = new Date(); }
  else return res.status(403).json({ error: '権限がありません' });
  await c.save();
  if (c.sellerSigned && c.buyerSigned) {
    await notify(c.seller, 'contract-done', `「${c.productName}」の契約が成立しました！`, c.productId);
    await notify(c.buyer, 'contract-done', `「${c.productName}」の契約が成立しました！`, c.productId);
  } else {
    const other = c.seller === user ? c.buyer : c.seller;
    await notify(other, 'contract-sign', `「${c.productName}」の契約書にサインしてください`, c.productId);
  }
  res.json(c);
});
// クーポンスキーマ
const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  owner: { type: String, required: true },
  type: { type: String, enum: ['amount', 'percent'], default: 'amount' },
  value: { type: Number, required: true },
  expiry: { type: String, default: '' },
  usedBy: { type: [String], default: [] },
  requireCode: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Coupon = mongoose.model('Coupon', couponSchema);

// クーポン発行
app.post('/api/coupons', async (req, res) => {
  const { code, productId, owner, type, value, expiry } = req.body;
  if (!code || !owner || !value) return res.status(400).json({ error: '必須項目が足りません' });
  try {
    const coupon = await Coupon.create({ code, productId: productId || null, owner, type, value, expiry });
    res.json(coupon);
  } catch(e) {
    if (e.code === 11000) return res.status(400).json({ error: 'そのコードはすでに使われています' });
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// クーポン確認・適用
app.get('/api/coupons/auto', async (req, res) => {
  const { productId, user } = req.query;
  const coupon = await Coupon.findOne({ productId, requireCode: false });
  if (!coupon) return res.json({});
  if (coupon.expiry && new Date() > new Date(coupon.expiry)) return res.json({});
  if (coupon.usedBy.includes(user)) return res.json({});
  coupon.usedBy.push(user);
  await coupon.save();
  res.json({ type: coupon.type, value: coupon.value });
});

app.post('/api/coupons/apply', async (req, res) => {
  const { code, productId, user } = req.body;
  const coupon = await Coupon.findOne({ code });
  if (!coupon) return res.status(404).json({ error: 'クーポンが見つかりません' });
  if (coupon.expiry && new Date() > new Date(coupon.expiry)) return res.status(400).json({ error: 'クーポンの有効期限が切れています' });
  if (coupon.usedBy.includes(user)) return res.status(400).json({ error: 'このクーポンはすでに使用済みです' });
  if (coupon.productId && coupon.productId.toString() !== productId) return res.status(400).json({ error: 'この商品には使えないクーポンです' });
  coupon.usedBy.push(user);
  await coupon.save();
  res.json({ type: coupon.type, value: coupon.value });
});

// 自分のクーポン一覧
app.get('/api/coupons', async (req, res) => {
  const { owner } = req.query;
  const coupons = await Coupon.find({ owner }).sort({ createdAt: -1 });
  res.json(coupons);
});

// クーポン削除
app.delete('/api/coupons/:id', async (req, res) => {
  const { requester } = req.body;
  const c = await Coupon.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'クーポンが見つかりません' });
  if (c.owner !== requester) return res.status(403).json({ error: '権限がありません' });
  await c.deleteOne();
  res.json({ ok: true });
});
app.get('/api/version', (req, res) => res.json({ v: Date.now() }));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// オークション自動進行（1分おきにチェック）
setInterval(async () => {
  try {
    const now = new Date();
    // 開始時刻が来たscheduled商品をopenに
    const toStart = await Product.find({ isAuction: true, auctionStatus: 'scheduled' });
    for (const p of toStart) {
      if (p.auctionStartDate && p.auctionStartTime) {
        const startAt = new Date(p.auctionStartDate + 'T' + p.auctionStartTime + ':00+09:00');
        if (now >= startAt) {
          p.auctionStatus = 'open';
          await p.save();
        }
      }
    }
    // 終了時刻が来たopen商品をconfirmingに
    const toEnd = await Product.find({ isAuction: true, auctionStatus: 'open' });
    for (const p of toEnd) {
      if (p.auctionEnd && now >= new Date(p.auctionEnd)) {
        const bids = await Bid.find({ productId: p._id }).sort({ amount: -1 });
        if (bids.length === 0) {
          p.auctionStatus = 'done';
        } else {
          p.auctionStatus = 'confirming';
          p.currentWinnerIndex = 0;
        }
        await p.save();
      }
    }
  } catch (e) {
    console.error('Auction timer error:', e);
  }
}, 60000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`文フリ server running on ${PORT}`));
