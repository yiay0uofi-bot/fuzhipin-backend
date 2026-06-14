/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   FUZHIPIN INC — Backend OAuth                          ║
 * ║   Discord OAuth2 + Roblox Verify + Supabase             ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || "1513696573454811317";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "sSHskDrBkLA64Bzv9speBkwZ_YSrThX3";
const FRONTEND_URL          = process.env.FRONTEND_URL          || "https://fuzhipin.netlify.app";
const REDIRECT_URI          = process.env.REDIRECT_URI          || "https://fuzhipin-backend-production.up.railway.app/auth/discord/callback";

const SB_URL = process.env.SUPABASE_URL || "https://sbmljisoaohxtzltnidb.supabase.co";
const SB_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNibWxqaXNvYW9oeHR6bHRuaWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NTkxNDUsImV4cCI6MjA5NjUzNTE0NX0.xTFj-fdUkdF1GoHLXs_ZvNFvkGTahTA5KcLinItGKic";
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
};

// ══════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════
app.use(cors({
  origin: [FRONTEND_URL, "http://localhost:3000", "http://127.0.0.1:5500"],
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "fuzhipin_secret_2025",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
  },
}));

// ══════════════════════════════════════════════
//  SUPABASE HELPERS
// ══════════════════════════════════════════════
async function sbGet(table, qs = "") {
  const url = `${SB_URL}/rest/v1/${table}${qs ? "?" + qs : ""}`;
  const r = await fetch(url, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbPost(table, data) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST", headers: SB_HEADERS, body: JSON.stringify(data),
  });
  const result = await r.json();
  return Array.isArray(result) ? result[0] : result;
}

async function sbPatch(table, qs, data) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH", headers: SB_HEADERS, body: JSON.stringify(data),
  });
  return r.ok;
}

// ══════════════════════════════════════════════
//  RUTAS — DISCORD OAUTH
// ══════════════════════════════════════════════

// 1. Redirigir al login de Discord
app.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds.members.read",
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// 2. Callback de Discord — recibe el código y obtiene el token
app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}?error=no_code`);

  try {
    // Intercambiar código por token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("No access token");

    // Obtener info del usuario
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    // Guardar/actualizar en Supabase
    const existing = await sbGet("fzp_users", `discord_id=eq.${user.id}`);
    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;

    if (existing.length > 0) {
      await sbPatch("fzp_users", `discord_id=eq.${user.id}`, {
        discord_username: `${user.username}${user.discriminator !== "0" ? "#" + user.discriminator : ""}`,
        discord_avatar: avatar,
        last_seen: new Date().toISOString(),
      });
    } else {
      await sbPost("fzp_users", {
        discord_id: user.id,
        discord_username: `${user.username}${user.discriminator !== "0" ? "#" + user.discriminator : ""}`,
        discord_avatar: avatar,
        role: "cliente",
      });
    }

    // Guardar sesión
    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar,
      tag: `${user.username}${user.discriminator !== "0" ? "#" + user.discriminator : ""}`,
    };

    // Redirigir al frontend con datos del usuario
    const params = new URLSearchParams({
      discord_id: user.id,
      discord_user: req.session.user.tag,
      discord_avatar: avatar,
      success: "1",
    });
    res.redirect(`${FRONTEND_URL}?${params}`);

  } catch (e) {
    console.error("Discord OAuth error:", e);
    res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
  }
});

// 3. Obtener sesión actual
app.get("/auth/me", (req, res) => {
  if (req.session.user) {
    res.json({ logged: true, user: req.session.user });
  } else {
    res.json({ logged: false });
  }
});

// 4. Cerrar sesión
app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.redirect(FRONTEND_URL);
});

// ══════════════════════════════════════════════
//  RUTAS — ROBLOX VERIFY
// ══════════════════════════════════════════════

// Verificar que un usuario de Roblox existe de verdad
app.post("/auth/roblox/verify", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ success: false, error: "Username requerido" });

  try {
    // Buscar usuario en API real de Roblox
    const robloxRes = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    const robloxData = await robloxRes.json();

    if (!robloxData.data || robloxData.data.length === 0) {
      return res.json({ success: false, error: "Usuario de Roblox no encontrado" });
    }

    const robloxUser = robloxData.data[0];

    // Obtener avatar
    const avatarRes = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUser.id}&size=150x150&format=Png`
    );
    const avatarData = await avatarRes.json();
    const avatarUrl = avatarData.data?.[0]?.imageUrl || null;

    // Si hay sesión de Discord activa, vincular en Supabase
    if (req.session.user) {
      await sbPatch("fzp_users", `discord_id=eq.${req.session.user.id}`, {
        roblox_username: robloxUser.name,
        roblox_id: String(robloxUser.id),
      });
    }

    res.json({
      success: true,
      roblox_id: robloxUser.id,
      roblox_username: robloxUser.name,
      roblox_avatar: avatarUrl,
    });

  } catch (e) {
    console.error("Roblox verify error:", e);
    res.json({ success: false, error: "Error verificando usuario de Roblox" });
  }
});

// ══════════════════════════════════════════════
//  RUTAS — API FUZHIPIN
// ══════════════════════════════════════════════

// Productos
app.get("/api/products", async (req, res) => {
  const { category } = req.query;
  let qs = "is_active=eq.true&order=id.asc";
  if (category && category !== "all") qs += `&category=eq.${category}`;
  const products = await sbGet("fzp_products", qs);
  res.json(products);
});

// Pedidos del usuario
app.get("/api/orders/me", async (req, res) => {
  if (!req.session.user) return res.json([]);
  const orders = await sbGet("fzp_orders",
    `user_discord=eq.${encodeURIComponent(req.session.user.tag)}&order=created_at.desc&limit=10`
  );
  res.json(orders);
});

// Crear pedido
app.post("/api/orders", async (req, res) => {
  const order = req.body;
  if (req.session.user) {
    order.user_discord = req.session.user.tag;
  }
  try {
    const result = await sbPost("fzp_orders", order);
    res.json({ success: true, order: result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Validar código de descuento
app.get("/api/codes/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();
  const codes = await sbGet("fzp_codes", `code=eq.${code}&status=eq.active`);
  if (!codes.length) return res.json({ valid: false, error: "Código inválido" });
  const c = codes[0];
  const today = new Date().toISOString().split("T")[0];
  if (c.expiry_date && c.expiry_date < today) return res.json({ valid: false, error: "Código expirado" });
  if (c.use_limit > 0 && c.uses_count >= c.use_limit) return res.json({ valid: false, error: "Código agotado" });
  res.json({ valid: true, code: c });
});

// Rifas activas
app.get("/api/raffles", async (req, res) => {
  const raffles = await sbGet("fzp_raffles", "status=eq.active&order=created_at.desc");
  res.json(raffles);
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "✅ Fuzhipin Backend Online",
    version: "1.0.0",
    endpoints: [
      "GET  /auth/discord          → Iniciar login Discord",
      "GET  /auth/discord/callback → Callback OAuth",
      "GET  /auth/me               → Sesión actual",
      "GET  /auth/logout           → Cerrar sesión",
      "POST /auth/roblox/verify    → Verificar usuario Roblox",
      "GET  /api/products          → Productos",
      "GET  /api/orders/me         → Mis pedidos",
      "POST /api/orders            → Crear pedido",
      "GET  /api/codes/:code       → Validar código",
      "GET  /api/raffles           → Rifas activas",
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Fuzhipin Backend corriendo en puerto ${PORT}`);
  console.log(`📡 Frontend: ${FRONTEND_URL}`);
  console.log(`🔗 Redirect URI: ${REDIRECT_URI}`);
});
