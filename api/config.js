// Öffentliche Einstellungen für die App (keine Geheimnisse).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(200).json({
    paymentLink: process.env.PAYMENT_LINK_URL || null,
    portalLogin: process.env.PORTAL_LOGIN_URL || null
  });
}
