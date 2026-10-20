// Автентифікація через JWT: POST /login видає токен за логіном і паролем,
// requireAuth перевіряє токен у заголовку Authorization для захищених ендпоінтів.
const jwt = require('jsonwebtoken');

// POST /login — тіло: {"username": "...", "password": "..."}
function login(req, res) {
  const username = req.body?.username;
  const password = req.body?.password;
  // Порожні значення відхиляємо до порівняння: інакше без AUTH_USER/AUTH_PASSWORD
  // запит без тіла пройшов би (undefined === undefined)
  if (
    !username ||
    !password ||
    !process.env.AUTH_USER ||
    !process.env.AUTH_PASSWORD ||
    username !== process.env.AUTH_USER ||
    password !== process.env.AUTH_PASSWORD
  ) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ sub: username }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  res.json({ token });
}

// Middleware: пропускає запит далі лише з дійсним токеном "Authorization: Bearer <token>"
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Явно задаємо алгоритм, щоб не прийняти токен, підписаний іншим (наприклад, "none")
    req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { login, requireAuth };
