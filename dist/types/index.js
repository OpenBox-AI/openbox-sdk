// ts/src/types/auth.ts
function decodeJwtExpiry(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed.exp === "number") {
      return parsed.exp * 1e3;
    }
    return null;
  } catch {
    return null;
  }
}
function isTokenExpired(token, bufferMs = 6e4) {
  const expiry = decodeJwtExpiry(token);
  if (expiry === null) {
    return true;
  }
  return Date.now() + bufferMs >= expiry;
}

// ts/src/types/generated/backend.ts
var backend_exports = {};

// ts/src/types/generated/core.ts
var core_exports = {};
export {
  backend_exports as Backend,
  core_exports as Core,
  decodeJwtExpiry,
  isTokenExpired
};
