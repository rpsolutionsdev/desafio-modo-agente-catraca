export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca',
  authSecret: process.env.AUTH_SECRET || 'catraca-local-session-secret-2026',
  partnerApiKey: process.env.PARTNER_API_KEY || 'catraca-partner-secret-key',
  gatewayDelayMultiplier: Number(process.env.GATEWAY_DELAY_MULTIPLIER || 1),
};
