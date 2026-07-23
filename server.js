const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "bloom.json");
const SEED_FILE = path.join(__dirname, "data", "seed.json");
const PUBLIC_DIR = path.join(__dirname, "public");

function ensureData() {
  if (!fs.existsSync(DATA_FILE)) fs.copyFileSync(SEED_FILE, DATA_FILE);
}
function readData() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function json(res, status, payload) {
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(payload));
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  });
  return out;
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, encoded) {
  const [salt, expected] = encoded.split(":");
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
function currentUser(req, data) {
  const sid = parseCookies(req).bloom_session;
  const session = sid && data.sessions[sid];
  if (!session || session.expiresAt < Date.now()) return null;
  return data.users.find(u => u.id === session.userId) || null;
}
function requireUser(req, res, data) {
  const user = currentUser(req, data);
  if (!user) {
    json(res, 401, {error:"AUTH_REQUIRED"});
    return null;
  }
  return user;
}
function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const types = {".html":"text/html", ".css":"text/css", ".js":"application/javascript", ".svg":"image/svg+xml"};
  res.writeHead(200, {"Content-Type": (types[ext] || "application/octet-stream") + "; charset=utf-8"});
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const data = readData();

  try {
    if (pathname === "/api/health") return json(res, 200, {ok:true, service:"bloom", version:"0.1.0"});
    if (pathname === "/api/status") {
      const user = currentUser(req, data);
      return json(res, 200, {
        setupRequired: !data.shop,
        authenticated: !!user,
        user: user ? {id:user.id,name:user.name,email:user.email,role:user.role} : null,
        shop: data.shop
      });
    }
    if (pathname === "/api/setup" && req.method === "POST") {
      if (data.shop) return json(res, 409, {error:"SETUP_ALREADY_COMPLETE"});
      const b = await body(req);
      if (!b.shopName || !b.ownerName || !b.email || !b.password || b.password.length < 8)
        return json(res, 400, {error:"VALIDATION_ERROR", message:"Shop, owner, email, and password of at least 8 characters are required."});
      const shopId = id("shop");
      const userId = id("user");
      data.shop = {id:shopId, name:b.shopName, address:b.address || "", phone:b.phone || "", createdAt:new Date().toISOString()};
      data.users.push({id:userId, shopId, name:b.ownerName, email:b.email.toLowerCase(), passwordHash:hashPassword(b.password), role:"OWNER", createdAt:new Date().toISOString()});
      const sid = crypto.randomBytes(32).toString("hex");
      data.sessions[sid] = {userId, expiresAt:Date.now()+1000*60*60*24*7};
      writeData(data);
      res.setHeader("Set-Cookie", `bloom_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return json(res, 201, {ok:true});
    }
    if (pathname === "/api/login" && req.method === "POST") {
      const b = await body(req);
      const user = data.users.find(u => u.email === String(b.email || "").toLowerCase());
      if (!user || !verifyPassword(String(b.password || ""), user.passwordHash))
        return json(res, 401, {error:"INVALID_CREDENTIALS"});
      const sid = crypto.randomBytes(32).toString("hex");
      data.sessions[sid] = {userId:user.id, expiresAt:Date.now()+1000*60*60*24*7};
      writeData(data);
      res.setHeader("Set-Cookie", `bloom_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return json(res, 200, {ok:true});
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      const sid = parseCookies(req).bloom_session;
      if (sid) delete data.sessions[sid];
      writeData(data);
      res.setHeader("Set-Cookie", "bloom_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      return json(res, 200, {ok:true});
    }

    if (pathname.startsWith("/api/")) {
      const user = requireUser(req, res, data);
      if (!user) return;

      if (pathname === "/api/dashboard") {
        const today = new Date().toISOString().slice(0,10);
        const todaysOrders = data.orders.filter(o => o.deliveryDate === today || o.pickupDate === today);
        const sales = data.orders.reduce((sum,o)=>sum + Number(o.total || 0),0);
        const lowStock = data.inventory.filter(i => Number(i.quantity) <= Number(i.reorderLevel));
        return json(res, 200, {
          shop:data.shop,
          metrics:{todaysOrders:todaysOrders.length,totalOrders:data.orders.length,totalCustomers:data.customers.length,sales,lowStock:lowStock.length},
          todaysOrders,
          lowStock,
          insight: lowStock.length ? `You have ${lowStock.length} item${lowStock.length===1?"":"s"} at or below the reorder level.` : "Inventory levels look healthy."
        });
      }

      if (pathname === "/api/customers") {
        if (req.method === "GET") return json(res, 200, data.customers);
        if (req.method === "POST") {
          const b = await body(req);
          if (!b.name) return json(res,400,{error:"VALIDATION_ERROR"});
          const customer = {id:id("cust"),name:b.name,email:b.email||"",phone:b.phone||"",notes:b.notes||"",createdAt:new Date().toISOString()};
          data.customers.push(customer); writeData(data); return json(res,201,customer);
        }
      }

      if (pathname === "/api/orders") {
        if (req.method === "GET") return json(res,200,data.orders);
        if (req.method === "POST") {
          const b = await body(req);
          if (!b.customerName || !b.total) return json(res,400,{error:"VALIDATION_ERROR"});
          const order = {id:id("order"),number:`B-${String(data.orders.length+1).padStart(5,"0")}`,customerName:b.customerName,recipient:b.recipient||"",occasion:b.occasion||"",status:b.status||"NEW",fulfillment:b.fulfillment||"DELIVERY",deliveryDate:b.deliveryDate||"",pickupDate:b.pickupDate||"",cardMessage:b.cardMessage||"",total:Number(b.total),createdAt:new Date().toISOString()};
          data.orders.push(order); writeData(data); return json(res,201,order);
        }
      }

      if (pathname === "/api/inventory") {
        if (req.method === "GET") return json(res,200,data.inventory);
        if (req.method === "POST") {
          const b = await body(req);
          if (!b.name) return json(res,400,{error:"VALIDATION_ERROR"});
          const item = {id:id("inv"),name:b.name,category:b.category||"Supplies",quantity:Number(b.quantity||0),reorderLevel:Number(b.reorderLevel||0),unit:b.unit||"each",cost:Number(b.cost||0)};
          data.inventory.push(item); writeData(data); return json(res,201,item);
        }
      }

      if (pathname === "/api/suppliers") return json(res,200,data.suppliers);
    }

    if (serveStatic(req, res, pathname)) return;
    if (!pathname.startsWith("/api/")) {
      req.url = "/index.html";
      if (serveStatic(req, res, "/index.html")) return;
    }
    json(res,404,{error:"NOT_FOUND"});
  } catch (err) {
    console.error(err);
    json(res,500,{error:"SERVER_ERROR",message:err.message});
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Bloom running at http://localhost:${PORT}`));
}
module.exports = { server, hashPassword, verifyPassword };
