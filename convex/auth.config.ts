// Clerk issues the JWTs Convex verifies. Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard
// (Clerk → JWT templates → "convex" → Issuer).
const authConfig = {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }],
};

export default authConfig;
