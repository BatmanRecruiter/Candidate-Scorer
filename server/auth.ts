import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.ADMIN_API_KEY;
  // Skip auth when no key is configured (safe for local development without credentials).
  if (!key) {
    next();
    return;
  }
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    res.status(401).json({ message: "Unauthorized: Authorization: Bearer <key> header required" });
    return;
  }
  let match = false;
  try {
    const keyBuf = Buffer.from(key, "utf8");
    const tokBuf = Buffer.from(token, "utf8");
    // timingSafeEqual requires equal-length buffers; length mismatch is an
    // immediate failure without leaking which bytes differ.
    if (keyBuf.length === tokBuf.length) {
      match = timingSafeEqual(keyBuf, tokBuf);
    }
  } catch {
    match = false;
  }
  if (!match) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
}
