import type { RequestHandler } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { supabase } from "../config/supabase.js";

const MAX_RECORDS = 500;

// ============================================
// TYPES
// ============================================

interface SmsRecord {
  sourceId: number;
  address: string;
  body: string;
  date: number;
  type: number;
}

interface CallRecord {
  sourceId: number;
  number: string;
  name?: string;
  date: number;
  duration: number;
  type: number;
}

// ============================================
// HELPERS
// ============================================

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
};

const isInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

// ============================================
// DEVICE AUTHENTICATION
// ============================================

const authenticateDevice = async (authorization?: string) => {
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
    .select("device_id, token_hash, sms_consent, calls_consent")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("Authentication error:", error);

    return {
      device: null,
      error: "Authentication failed",
      status: 500,
    };
  }

  if (!device || !safeEqual(device.token_hash, tokenHash)) {
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
// SMS VALIDATION
// ============================================

const validateSms = (record: SmsRecord): boolean => {
  return (
    record !== null &&
    typeof record === "object" &&
    isInteger(record.sourceId) &&
    record.sourceId >= 0 &&
    isString(record.address, 64) &&
    isString(record.body, 10000) &&
    isInteger(record.date) &&
    isInteger(record.type)
  );
};

// ============================================
// CALL VALIDATION
// ============================================

const validateCall = (record: CallRecord): boolean => {
  return (
    record !== null &&
    typeof record === "object" &&
    isInteger(record.sourceId) &&
    record.sourceId >= 0 &&
    isString(record.number, 64) &&
    (record.name === undefined || isString(record.name, 200)) &&
    isInteger(record.date) &&
    isInteger(record.duration) &&
    record.duration >= 0 &&
    isInteger(record.type)
  );
};

// ============================================
// SYNC DATABASE HELPER
// ============================================

const updateLastSync = async (deviceId: string) => {
  const { error } = await supabase
    .from("devices")
    .update({
      last_sync_at: new Date().toISOString(),
    })
    .eq("device_id", deviceId);

  if (error) {
    console.error("Last sync update error:", error);
    throw new Error("Could not update last sync time");
  }
};

// ============================================
// 1. SYNC SMS
// POST /api/sync/sms
// ============================================

export const syncSms: RequestHandler = async (req, res) => {
  try {
    // Authenticate device
    const auth = await authenticateDevice(req.headers.authorization);

    if (!auth.device) {
      res.status(auth.status).json({
        error: auth.error,
      });
      return;
    }

    const device = auth.device;
    const { deviceId, records } = req.body || {};

    // Verify device ID
    if (deviceId !== device.device_id) {
      res.status(403).json({
        error: "deviceId does not match token",
      });
      return;
    }

    // Verify consent
    if (!device.sms_consent) {
      res.status(403).json({
        error: "Device has not consented to SMS sync",
      });
      return;
    }

    // Validate records array
    if (!Array.isArray(records)) {
      res.status(400).json({
        error: "records must be an array",
      });
      return;
    }

    if (records.length > MAX_RECORDS) {
      res.status(413).json({
        error: `Max ${MAX_RECORDS} records per request`,
      });
      return;
    }

    for (let i = 0; i < records.length; i++) {
      if (!validateSms(records[i])) {
        res.status(400).json({
          error: `Invalid SMS record at index ${i}`,
        });
        return;
      }
    }

    // Prepare database records
    const rows = records.map((record: SmsRecord) => ({
      device_id: device.device_id,
      source_id: record.sourceId,
      address: record.address,
      body: record.body,
      date: record.date,
      type: record.type,
    }));

    // Insert records and ignore existing duplicates
    let accepted = 0;

    if (rows.length > 0) {
      const { data, error } = await supabase
        .from("sms_records")
        .upsert(rows, {
          onConflict: "device_id,source_id",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) {
        console.error("SMS database error:", error);

        res.status(500).json({
          error: "Could not save SMS records",
        });
        return;
      }

      accepted = data?.length || 0;
    }

    // Update device sync timestamp
    await updateLastSync(device.device_id);

    res.status(200).json({
      accepted,
      duplicates: records.length - accepted,
    });
  } catch (error) {
    console.error("SMS sync error:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};

// ============================================
// 2. SYNC CALLS
// POST /api/sync/calls
// ============================================

export const syncCall: RequestHandler = async (req, res) => {
  try {
    // Authenticate device
    const auth = await authenticateDevice(req.headers.authorization);

    if (!auth.device) {
      res.status(auth.status).json({
        error: auth.error,
      });
      return;
    }

    const device = auth.device;
    const { deviceId, records } = req.body || {};

    // Verify device ID
    if (deviceId !== device.device_id) {
      res.status(403).json({
        error: "deviceId does not match token",
      });
      return;
    }

    // Verify consent
    if (!device.calls_consent) {
      res.status(403).json({
        error: "Device has not consented to calls sync",
      });
      return;
    }

    // Validate records array
    if (!Array.isArray(records)) {
      res.status(400).json({
        error: "records must be an array",
      });
      return;
    }

    if (records.length > MAX_RECORDS) {
      res.status(413).json({
        error: `Max ${MAX_RECORDS} records per request`,
      });
      return;
    }

    for (let i = 0; i < records.length; i++) {
      if (!validateCall(records[i])) {
        res.status(400).json({
          error: `Invalid call record at index ${i}`,
        });
        return;
      }
    }

    // Prepare database records
    const rows = records.map((record: CallRecord) => ({
      device_id: device.device_id,
      source_id: record.sourceId,
      number: record.number,
      name: record.name ?? null,
      date: record.date,
      duration: record.duration,
      type: record.type,
    }));

    // Insert records and ignore existing duplicates
    let accepted = 0;

    if (rows.length > 0) {
      const { data, error } = await supabase
        .from("call_records")
        .upsert(rows, {
          onConflict: "device_id,source_id",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) {
        console.error("Calls database error:", error);

        res.status(500).json({
          error: "Could not save call records",
        });
        return;
      }

      accepted = data?.length || 0;
    }

    // Update device sync timestamp
    await updateLastSync(device.device_id);

    res.status(200).json({
      accepted,
      duplicates: records.length - accepted,
    });
  } catch (error) {
    console.error("Calls sync error:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};
