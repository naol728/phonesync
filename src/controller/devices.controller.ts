import type { RequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
// ============================================
// CONFIGURATION
// ============================================

const REGISTRATION_KEY = env.REGISTRATION_KEY || "";

// ============================================
// HELPERS
// ============================================

const sha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));

  return x.length === y.length && timingSafeEqual(x, y);
};

const isString = (value: unknown, max: number): value is string => {
  return typeof value === "string" && value.length <= max;
};

// ============================================
// AUTHENTICATION
// ============================================

const authenticateDevice = async (authorization: string | undefined) => {
  const match = /^Bearer (.+)$/.exec(authorization || "");

  if (!match) {
    return {
      device: null,
      error: "Missing token",
      status: 401,
    };
  }

  const tokenHash = sha256(match[1]);

  const { data: device, error } = await supabase
    .from("devices")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("Device authentication error:", error);

    return {
      device: null,
      error: "Authentication failed",
      status: 500,
    };
  }

  if (!device) {
    return {
      device: null,
      error: "Invalid token",
      status: 401,
    };
  }

  return {
    device,
    error: null,
    status: 200,
  };
};

// ============================================
// 1. REGISTER DEVICE
// POST /api/devices/register
// ============================================

export const registerDevice: RequestHandler = async (req, res) => {
  try {
    const { deviceId, name, platform, osVersion, consent } = req.body || {};

    // Validate device ID
    if (
      typeof deviceId !== "string" ||
      !/^[A-Za-z0-9-]{8,64}$/.test(deviceId)
    ) {
      res.status(400).json({
        error: "deviceId must be 8-64 letters, digits or dashes",
      });
      return;
    }

    // Validate consent
    if (
      !consent ||
      typeof consent.sms !== "boolean" ||
      typeof consent.calls !== "boolean"
    ) {
      res.status(400).json({
        error: "consent {sms, calls} is required",
      });
      return;
    }

    if (!consent.sms && !consent.calls) {
      res.status(400).json({
        error: "At least one of sms/calls must be consented",
      });
      return;
    }

    // Validate optional device information
    if (
      (name !== undefined && !isString(name, 100)) ||
      (platform !== undefined && !isString(platform, 20)) ||
      (osVersion !== undefined && !isString(osVersion, 20))
    ) {
      res.status(400).json({
        error: "Invalid device information",
      });
      return;
    }

    if (
      consent.grantedAt !== undefined &&
      typeof consent.grantedAt !== "string"
    ) {
      res.status(400).json({
        error: "consent.grantedAt must be a string",
      });
      return;
    }

    // Check whether device already exists
    const { data: previousDevice, error: lookupError } = await supabase
      .from("devices")
      .select("registered_at, last_sync_at")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (lookupError) {
      console.error("Device lookup error:", lookupError);

      res.status(500).json({
        error: "Could not check existing device",
      });
      return;
    }

    // Generate a new secure authentication token
    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256(token);

    // Save device in Supabase
    const { error: insertError } = await supabase.from("devices").upsert(
      {
        device_id: deviceId,
        name: name || "",
        platform: platform || "",
        os_version: osVersion || "",

        token_hash: tokenHash,

        sms_consent: consent.sms,
        calls_consent: consent.calls,

        consent_granted_at: consent.grantedAt || new Date().toISOString(),

        registered_at:
          previousDevice?.registered_at || new Date().toISOString(),

        last_sync_at: previousDevice?.last_sync_at || null,
      },
      {
        onConflict: "device_id",
      },
    );

    if (insertError) {
      console.error("Device registration error:", insertError);

      res.status(500).json({
        error: "Could not register device",
      });
      return;
    }

    // Return plaintext token only once
    res.status(201).json({
      deviceId,
      token,
    });
  } catch (error) {
    console.error("Register device error:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};

// ============================================
// 2. GET DEVICE STATUS
// GET /api/devices/status
// ============================================

export const deviceStatus: RequestHandler = async (req, res) => {
  try {
    // Authenticate device using Bearer token
    const auth = await authenticateDevice(req.headers.authorization);

    if (!auth.device) {
      res.status(auth.status).json({
        error: auth.error,
      });
      return;
    }

    const device = auth.device;

    // Get SMS count
    const { count: smsCount, error: smsError } = await supabase
      .from("sms_records")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("device_id", device.device_id);

    if (smsError) {
      console.error("SMS count error:", smsError);

      res.status(500).json({
        error: "Could not retrieve SMS count",
      });
      return;
    }

    // Get calls count
    const { count: callsCount, error: callsError } = await supabase
      .from("call_records")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("device_id", device.device_id);

    if (callsError) {
      console.error("Calls count error:", callsError);

      res.status(500).json({
        error: "Could not retrieve calls count",
      });
      return;
    }

    // Return device status
    res.status(200).json({
      deviceId: device.device_id,

      registeredAt: new Date(device.registered_at).getTime(),

      lastSyncAt: device.last_sync_at
        ? new Date(device.last_sync_at).getTime()
        : 0,

      counts: {
        sms: smsCount || 0,
        calls: callsCount || 0,
      },

      consent: {
        sms: device.sms_consent,
        calls: device.calls_consent,
        grantedAt: device.consent_granted_at,
      },
    });
  } catch (error) {
    console.error("Device status error:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};
